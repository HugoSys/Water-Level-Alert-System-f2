import pyart
import fsspec
import rasterio
import geopandas as gpd
from osgeo import gdal
from datetime import datetime as dt
from rasterstats import zonal_stats
import os
import numpy as np

class RadarProcessor:
    def __init__(self):
        # Configuración de Radar
        self.url = "https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2/KEPZ/"
        self.fs = fsspec.filesystem("https")
        self.site = "KEPZ"
        self.geotiff = "temp.tif"
        
        # Rutas de Capas SHP (Asegúrate de que los nombres coincidan con tus carpetas)
        self.basins_path = "SHP/MICROCUENCAS.shp"
        self.colonias_path = "SHP/Colonias/Colonias.shp"
        self.vialidad_path = "SHP/Vialidad/Vialidades.shp"
        
        # Salida de resultados
        self.basins_max = "SHP/MICROCUENCAS_MAX.shp"

    def _fetch_radar(self):
        """Busca el archivo más reciente en NOAA"""
        files = self.fs.ls(self.url, detail=True)
        sorted_files = sorted(files, key=lambda x: x["name"])
        return sorted_files[len(files) - 3]["name"]

    def procesar(self):
        try:
            archivo_url = self._fetch_radar()
            print(f"Descargando datos de KEPZ: {archivo_url}")

            with self.fs.open(archivo_url, "rb") as f:
                # 1. Procesamiento Py-ART
                radar = pyart.io.read_nexrad_archive(f, station=self.site)
                radar = pyart.retrieve.ZtoR(radar, save_name="rain_rate")

                # Filtro de Ruido (Umbral Institucional: 2.5 mm/hr)
                # NOTA: Descomenta estas líneas cuando quieras producción real
                # gateFilter = pyart.correct.GateFilter(radar)
                # gateFilter.exclude_below("rain_rate", 2.5)
                # radar.fields["rain_rate"]["data"][gateFilter.gate_excluded] = -9999

                grid = pyart.map.grid_from_radars(
                    (radar,),
                    grid_shape=(1, 501, 501),
                    grid_limits=((1000, 1000), (-200000, 200000), (-200000, 200000)),
                    fields=["rain_rate"],
                )
                
                pyart.io.write_grid_geotiff(grid, self.geotiff, field="rain_rate", level=0)

            # 2. Refinamiento con GDAL (Metadatos y NoData)
            ds = gdal.Open(self.geotiff, gdal.GA_Update)
            band = ds.GetRasterBand(1)
            band.SetNoDataValue(-9999)
            
            # Insertar Metadatos de la Coordinación
            now = dt.now()
            ds.SetMetadata({
                "AUTOR": "Coordinación de Geoinformática y Planeación",
                "SISTEMA": "Monitor de Inundaciones Juárez",
                "FECHA": now.strftime("%Y-%m-%d %H:%M:%S")
            })
            ds = None # Cerrar para guardar

            # 3. Análisis Espacial con Rasterio y GeoPandas
            with rasterio.open(self.geotiff) as src:
                array = src.read(1)
                affine = src.transform
                nodata = src.nodata

            # --- ANÁLISIS POR MICROCUENCAS ---
            basins = gpd.read_file(self.basins_path).to_crs(epsg=4326)
            stats_basins = zonal_stats(basins, array, affine=affine, stats=["max"], nodata=nodata)

            # --- ANÁLISIS POR COLONIAS ---
            # Solo si el archivo existe
            col_afectadas = []
            if os.path.exists(self.colonias_path):
                colonias = gpd.read_file(self.colonias_path).to_crs(epsg=4326)
                stats_col = zonal_stats(colonias, array, affine=affine, stats=["max"], nodata=nodata)
                
                for i, s in enumerate(stats_col):
                    if s['max'] and s['max'] > 1.0: # Umbral mínimo para reporte
                        nombre = colonias.iloc[i].get('NOMBRE') or colonias.iloc[i].get('nombre') or f"Colonia {i}"
                        col_afectadas.append({"nombre": nombre, "intensidad": round(s['max'], 2)})

            # 4. Consolidación de Resultados
            resultados_basins = []
            for i, s in enumerate(stats_basins):
                nombre = basins.iloc[i].get('NOMBRE') or basins.iloc[i].get('nombre') or f"Cuenca {i}"
                valor = round(s['max'], 2) if s['max'] is not None else 0
                resultados_basins.append({"nombre": nombre, "max_lluvia": valor})

            # Guardar SHP actualizado para QGIS
            basins_final = basins.join(gpd.GeoDataFrame(stats_basins))
            basins_final.to_file(self.basins_max)

            return {
                "status": "success", 
                "datos": resultados_basins, 
                "colonias_criticas": col_afectadas[:10] # Top 10 colonias
            }

        except Exception as e:
            print(f"Error crítico en el motor: {e}")
            return {"status": "error", "detalle": str(e)}