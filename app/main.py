from fastapi import FastAPI, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import geopandas as gpd
import json
from .radar_core import RadarProcessor 
import uvicorn
from datetime import datetime
import os

# IMPORTANTE: Librería para la automatización
from fastapi_utils.tasks import repeat_every

app = FastAPI(title="Monitor de Inundaciones Juárez")

# Asegurar que la carpeta static exista
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

# --- TAREA AUTOMÁTICA ---
# Se ejecuta cada 7 minutos (420 segundos)
@app.on_event("startup")
@repeat_every(seconds=420) 
def tarea_automatica_radar():
    actualizar_estado_tarea_core()

def actualizar_estado_tarea_core():
    global estado_ciudad
    inicio = datetime.now()
    print(f"[{inicio.strftime('%H:%M:%S')}] (AUTO) Iniciando procesamiento de radar...")
    
    # El radar_core procesa la lluvia sobre las cuencas
    resultado = radar.procesar()
    
    if resultado["status"] == "success":
        fin = datetime.now()
        estado_ciudad["ultima_actualizacion"] = fin.strftime("%Y-%m-%d %H:%M:%S")
        
        # Guardamos los datos técnicos de las cuencas
        estado_ciudad["detalle_cuencas"] = resultado["datos"]
        
        # EXTRAEMOS LAS COLONIAS (Se asume que radar.procesar() las incluye ahora)
        # Si radar_core aún no las procesa, aquí se recibe una lista vacía
        estado_ciudad["colonias_criticas"] = resultado.get("colonias", [])
        
        # Lógica de alertas basada en el valor máximo detectado
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
    """Devuelve el estado actual con cuencas y colonias"""
    return estado_ciudad

@app.get("/mapa-cuencas")
async def obtener_geometrias_cuencas():
    """Endpoint técnico (opcional en el mapa)"""
    ruta = "SHP/MICROCUENCAS.shp"
    if not os.path.exists(ruta):
        return {"error": "No se encontró el archivo de microcuencas"}
    df = gpd.read_file(ruta).to_crs(epsg=4326)
    return json.loads(df.to_json())

@app.get("/mapa-colonias")
async def get_colonias_geo():
    """Endpoint principal para la visualización en el mapa"""
    ruta = "SHP/Colonias/Colonias.shp"
    if not os.path.exists(ruta):
        return {"error": f"No se encontró el archivo en {ruta}"}
    
    # Conversión a EPSG:4326 para Leaflet
    df = gpd.read_file(ruta).to_crs(epsg=4326)
    return json.loads(df.to_json())

@app.get("/mapa-vialidades")
async def get_vialidades():
    """Carga la traza urbana"""
    ruta = "SHP/Vialidad/Vialidades.shp"
    if not os.path.exists(ruta):
        # Intento con nombre en singular si falla el plural
        ruta = "SHP/Vialidad/Vialidad.shp"
        
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "No se encontró el archivo de vialidades"}
@app.get("/mapa-hospitales")
async def get_hospitales():
    ruta = "SHP/Hospitales_2025/Hospitales_2025.shp" # Ajusta el nombre exacto del .shp
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "No se encontró el archivo de hospitales"}

@app.get("/mapa-comunitarios")
async def get_comunitarios():
    ruta = "SHP/CENTROS_COMUNITARIOS_2025/CENTROS_COMUNITARIOS_2025.shp"
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "No se encontró el archivo de centros comunitarios"}

@app.get("/mapa-escuelas")
async def get_escuelas():
    ruta = "SHP/Escuelas_17122025/Escuelas_17122025.shp"
    if os.path.exists(ruta):
        df = gpd.read_file(ruta).to_crs(epsg=4326)
        return json.loads(df.to_json())
    return {"error": "No se encontró el archivo de escuelas"}

@app.post("/procesar")
async def ejecutar_manual(background_tasks: BackgroundTasks):
    """Permite disparar el proceso manualmente"""
    background_tasks.add_task(actualizar_estado_tarea_core)
    return {"mensaje": "Procesamiento manual iniciado"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)