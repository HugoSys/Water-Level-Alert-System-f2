from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import geopandas as gpd
import json
import rasterio # <-- Nueva para leer el TIF
from .radar_core import RadarProcessor 
import uvicorn
from datetime import datetime
import os
import httpx 

# Librería para la automatización
from fastapi_utils.tasks import repeat_every

app = FastAPI(title="Monitor de Inundaciones Juárez")

if not os.path.exists("static"):
    os.makedirs("static")

app.mount("/static", StaticFiles(directory="static"), name="static")

radar = RadarProcessor()

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
    print(f"[{inicio.strftime('%H:%M:%S')}] (AUTO) Iniciando procesamiento de radar...")
    
    resultado = radar.procesar()
    
    if resultado["status"] == "success":
        fin = datetime.now()
        estado_ciudad["ultima_actualizacion"] = fin.strftime("%Y-%m-%d %H:%M:%S")
        estado_ciudad["detalle_cuencas"] = resultado["datos"]
        estado_ciudad["colonias_criticas"] = resultado.get("colonias", [])
        
        max_detectado = max([c['max_lluvia'] for c in resultado["datos"]]) if resultado["datos"] else 0
        
        if max_detectado > 30:
            estado_ciudad["alerta"] = "PELIGRO: Inundación Inminente"
        elif max_detectado > 15:
            estado_ciudad["alerta"] = "ALERTA: Lluvia Fuerte"
        elif max_detectado > 5:
            estado_ciudad["alerta"] = "PRECAUCIÓN: Lluvia Moderada"
        else:
            estado_ciudad["alerta"] = "Normal"
            
        print(f"Actualización Automática Exitosa. Máximo: {max_detectado} mm/hr")
    else:
        print(f"Error en tarea automática: {resultado.get('detalle')}")

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

# --- ENDPOINT DE SIMULACIÓN DESDE TIF ---
@app.get("/simular-tif")
async def simular_tif():
    """
    Lee un archivo TIF específico y devuelve el valor máximo de precipitación
    para simular una respuesta de emergencia en el frontend.
    """
    tif_path = r"D:\sistema_inundaciones_juarez\rainfall_filtered_tif_test2\rainfall_filtered_tif_test2_moved.tif"
    
    if not os.path.exists(tif_path):
        raise HTTPException(status_code=404, detail="Archivo TIF de simulación no encontrado.")

    try:
        with rasterio.open(tif_path) as src:
            # Leemos la primera banda (precipitación)
            band1 = src.read(1)
            # Obtenemos el valor máximo (limpiando posibles valores nulos/inf)
            import numpy as np
            max_lluvia = float(np.nanmax(band1))
            
            return {
                "status": "success",
                "max_mm": max_lluvia,
                "timestamp": datetime.now().isoformat(),
                "archivo": os.path.basename(tif_path)
            }
    except Exception as e:
        return JSONResponse(
            status_code=500, 
            content={"status": "error", "detail": f"Error al leer el TIF: {str(e)}"}
        )

@app.get("/prediccion-lluvia")
async def obtener_prediccion_lluvia(lat: float = 31.7333, lon: float = -106.4833):
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&"
        f"hourly=precipitation,precipitation_probability&"
        f"timezone=America/Denver"
    )
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
            
            tiempos = data["hourly"]["time"]
            precipitacion = data["hourly"]["precipitation"]
            probabilidad = data["hourly"]["precipitation_probability"]
            
            pronostico = [
                {"hora": t, "mm": p, "probabilidad": prob}
                for t, p, prob in zip(tiempos, precipitacion, probabilidad)
            ][:24]
            
            return {"status": "success", "data": pronostico}
            
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Error conectando con Open-Meteo: {str(e)}")

@app.get("/mapa-colonias")
async def get_colonias_geo():
    ruta_colonias = "SHP/Colonias/Colonias.shp"
    if not os.path.exists(ruta_colonias):
        return {"error": f"No se encontró el archivo en {ruta_colonias}"}
    
    df_colonias = gpd.read_file(ruta_colonias).to_crs(epsg=4326)

    capas_puntos = [
        ("hospitales", "SHP/Hospitales_2025/Hospitales_2025.shp"),
        ("comunitarios", "SHP/CENTROS_COMUNITARIOS_2025/CENTROS_COMUNITARIOS_2025.shp"),
        ("escuelas", "SHP/Escuelas_17122025/Escuelas_17122025.shp")
    ]

    for etiqueta, ruta in capas_puntos:
        if os.path.exists(ruta):
            try:
                puntos = gpd.read_file(ruta).to_crs(epsg=4326)
                unidos = gpd.sjoin(puntos, df_colonias, how="left", predicate="within")
                conteo = unidos.groupby("index_right").size()
                df_colonias[etiqueta] = df_colonias.index.map(conteo).fillna(0).astype(int)
            except Exception as e:
                print(f"Error procesando {etiqueta}: {e}")
                df_colonias[etiqueta] = 0
        else:
            df_colonias[etiqueta] = 0

    return json.loads(df_colonias.to_json())

@app.get("/mapa-cuencas")
async def obtener_geometrias_cuencas():
    ruta = "SHP/MICROCUENCAS.shp"
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "No se encontró el archivo de microcuencas"}

@app.get("/mapa-vialidades")
async def get_vialidades():
    ruta = "SHP/Vialidad/Vialidades.shp"
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "No se encontró el archivo de vialidades"}

@app.post("/procesar")
async def ejecutar_manual(background_tasks: BackgroundTasks):
    background_tasks.add_task(actualizar_estado_tarea_core)
    return {"mensaje": "Procesamiento manual iniciado"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
