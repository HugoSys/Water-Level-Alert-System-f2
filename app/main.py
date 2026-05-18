from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import geopandas as gpd
import json
import rasterio
import numpy as np
import uvicorn
import os
import httpx
import unicodedata
from datetime import datetime
from rasterstats import zonal_stats
from .radar_core import RadarProcessor 
from fastapi_utils.tasks import repeat_every

app = FastAPI(title="Monitor de Inundaciones Juárez")

# --- CONFIGURACIÓN DE DIRECTORIOS ---
for path in ["static", "static/data"]:
    if not os.path.exists(path):
        os.makedirs(path)

app.mount("/static", StaticFiles(directory="static"), name="static")

radar = RadarProcessor()

# --- UTILIDAD: NORMALIZACIÓN DE TEXTO ---
def limpiar_nombre(texto):
    """Limpia nombres para asegurar coincidencia entre TIF, SHP y JS."""
    if not texto: return ""
    # Pasar a mayúsculas y quitar espacios en los extremos
    texto = str(texto).strip().upper()
    # Eliminar acentos y diacríticos
    return ''.join(c for c in unicodedata.normalize('NFD', texto)
                  if unicodedata.category(c) != 'Mn')

# Estado global del sistema
estado_ciudad = {
    "ultima_actualizacion": "Iniciando sistema...",
    "alerta": "Normal",
    "detalle_cuencas": [],
    "colonias_criticas": []
}

@app.on_event("startup")
@repeat_every(seconds=420) 
def tarea_automatica_radar():
    actualizar_estado_tarea_core()

def actualizar_estado_tarea_core():
    global estado_ciudad
    inicio = datetime.now()
    print(f"[{inicio.strftime('%H:%M:%S')}] (AUTO) Procesando radar...")
    
    resultado = radar.procesar()
    
    if resultado["status"] == "success":
        fin = datetime.now()
        estado_ciudad["ultima_actualizacion"] = fin.strftime("%Y-%m-%d %H:%M:%S")
        estado_ciudad["detalle_cuencas"] = resultado["datos"]
        
        # Normalizamos nombres en el monitoreo automático
        estado_ciudad["colonias_criticas"] = [
            {"nombre": limpiar_nombre(c['nombre']), "intensidad": c['intensidad']} 
            for c in resultado.get("colonias", [])
        ]
        
        max_detectado = max([c['max_lluvia'] for c in resultado["datos"]]) if resultado["datos"] else 0
        
        if max_detectado > 30:
            estado_ciudad["alerta"] = "PELIGRO: Inundación Inminente"
        elif max_detectado > 15:
            estado_ciudad["alerta"] = "ALERTA: Lluvia Fuerte"
        elif max_detectado > 5:
            estado_ciudad["alerta"] = "PRECAUCIÓN: Lluvia Moderada"
        else:
            estado_ciudad["alerta"] = "Normal"
    else:
        print(f"Error en tarea: {resultado.get('detalle')}")

# --- ENDPOINTS ---

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    ruta_index = "static/index.html"
    if os.path.exists(ruta_index):
        with open(ruta_index, "r", encoding="utf-8") as f:
            return f.read()
    return "Error: static/index.html no encontrado."

@app.get("/estado")
async def consultar_estado():
    return estado_ciudad

# --- SIMULACIÓN DINÁMICA POR COLONIA (TIF) ---
@app.get("/simular-tif")
async def simular_tif():
    """
    Analiza el TIF optimizado y devuelve la intensidad de lluvia
    normalizada por colonia para el pintado del mapa.
    """
    tif_path = "static/data/lluvia_juarez_recortada.tif"
    ruta_shp_colonias = "SHP/Colonias/Colonias.shp"
    
    if not os.path.exists(tif_path):
        raise HTTPException(status_code=404, detail="Archivo recortado no encontrado. Ejecute script.py primero.")

    try:
        df_colonias = gpd.read_file(ruta_shp_colonias)
        
        # Estadística Zonal: Extrae el valor máximo del TIF para cada polígono de colonia
        stats = zonal_stats(
            df_colonias, 
            tif_path, 
            stats="max", 
            nodata=-999,
            all_touched=True
        )

        resultado_colonias = []
        max_global = 0

        for i, registro in enumerate(stats):
            nombre_original = df_colonias.iloc[i]['NOMBRE']
            valor_lluvia = registro['max'] if registro['max'] is not None else 0
            
            if valor_lluvia > 0.1:
                resultado_colonias.append({
                    "nombre": limpiar_nombre(nombre_original), # Normalizamos para match con JS
                    "intensidad": round(float(valor_lluvia), 2)
                })
                if valor_lluvia > max_global:
                    max_global = valor_lluvia

        return {
            "status": "success",
            "max_mm": float(max_global),
            "colonias_afectadas": resultado_colonias,
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        return JSONResponse(
            status_code=500, 
            content={"status": "error", "detail": f"Error en simulación: {str(e)}"}
        )

@app.get("/mapa-colonias")
async def get_colonias_geo():
    ruta_colonias = "SHP/Colonias/Colonias.shp"
    if not os.path.exists(ruta_colonias):
        return {"error": "SHP de colonias no encontrado"}
    
    # Cargamos y normalizamos nombres en el GeoJSON
    df_colonias = gpd.read_file(ruta_colonias).to_crs(epsg=4326)
    df_colonias['NOMBRE'] = df_colonias['NOMBRE'].apply(limpiar_nombre)

    # Análisis de infraestructura crítica
    capas_puntos = [
        ("hospitales", "SHP/Hospitales_2025/Hospitales_2025.shp"),
        ("comunitarios", "SHP/CENTROS_COMUNITARIOS_2025/CENTROS_COMUNITARIOS_2025.shp"),
        ("escuelas", "SHP/SEECH070326/SEECH070326.shp"),
        ("bomberos", "SHP/EstacionBomberos/EstacionBomberos/EstacionbomberosWgs84.shp")
    ]

    for etiqueta, ruta in capas_puntos:
        if os.path.exists(ruta):
            try:
                puntos = gpd.read_file(ruta).to_crs(epsg=4326)
                unidos = gpd.sjoin(puntos, df_colonias, how="left", predicate="within")
                conteo = unidos.groupby("index_right").size()
                df_colonias[etiqueta] = df_colonias.index.map(conteo).fillna(0).astype(int)
            except Exception as e:
                print(f"Error procesando la capa {etiqueta}: {e}")
                df_colonias[etiqueta] = 0
        else:
            print(f"Advertencia: No se encontró el archivo en {ruta}")
            df_colonias[etiqueta] = 0

    return json.loads(df_colonias.to_json())

@app.get("/prediccion-lluvia")
async def obtener_prediccion_lluvia(lat: float = 31.7333, lon: float = -106.4833):
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=precipitation,precipitation_probability&timezone=America/Denver"
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            data = response.json()
            h = data.get("hourly", {})
            pronostico = [
                {"hora": t, "mm": p, "probabilidad": prob}
                for t, p, prob in zip(h.get("time", []), h.get("precipitation", []), h.get("precipitation_probability", []))
            ][:24]
            return {"status": "success", "data": pronostico}
    except:
        return {"status": "error", "data": []}

@app.get("/mapa-cuencas")
async def obtener_geometrias_cuencas():
    ruta = "SHP/MICROCUENCAS.shp"
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "Archivo de microcuencas no encontrado"}

@app.get("/mapa-vialidades")
async def get_vialidades():
    ruta = "SHP/Vialidad/Vialidades.shp"
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "Archivo de vialidades no encontrado"}

# --- ENDPOINTS INDIVIDUALES DE INFRAESTRUCTURA ---

@app.get("/mapa-bomberos")
async def obtener_bomberos():
    ruta = "SHP/EstacionBomberos/EstacionBomberos/EstacionbomberosWgs84.shp"
    if os.path.exists(ruta):
        try:
            df = gpd.read_file(ruta).to_crs(epsg=4326)
            return json.loads(df.to_json())
        except Exception as e:
            return {"error": f"Error al procesar bomberos: {str(e)}"}
    return {"error": "Archivo de estaciones de bomberos no encontrado"}

@app.get("/mapa-escuelas")
async def obtener_escuelas_seech():
    ruta = "SHP/SEECH070326/SEECH070326.shp"
    if os.path.exists(ruta):
        try:
            df = gpd.read_file(ruta).to_crs(epsg=4326)
            return json.loads(df.to_json())
        except Exception as e:
            return {"error": f"Error al procesar escuelas: {str(e)}"}
    return {"error": "Archivo de escuelas SEECH no encontrado"}

@app.get("/mapa-hospitales")
async def obtener_hospitales():
    ruta = "SHP/Hospitales_2025/Hospitales_2025.shp"
    if os.path.exists(ruta):
        try:
            df = gpd.read_file(ruta).to_crs(epsg=4326)
            return json.loads(df.to_json())
        except Exception as e:
            return {"error": f"Error al procesar hospitales: {str(e)}"}
    return {"error": "Archivo de hospitales no encontrado"}

@app.get("/mapa-comunitarios")
async def obtener_comunitarios():
    ruta = "SHP/CENTROS_COMUNITARIOS_2025/CENTROS_COMUNITARIOS_2025.shp"
    if os.path.exists(ruta):
        try:
            df = gpd.read_file(ruta).to_crs(epsg=4326)
            return json.loads(df.to_json())
        except Exception as e:
            return {"error": f"Error al procesar centros comunitarios: {str(e)}"}
    return {"error": "Archivo de centros comunitarios no encontrado"}

@app.post("/procesar")
async def ejecutar_manual(background_tasks: BackgroundTasks):
    background_tasks.add_task(actualizar_estado_tarea_core)
    return {"mensaje": "Procesamiento manual iniciado"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
