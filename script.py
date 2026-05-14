import geopandas as gpd
import rasterio
from rasterio.mask import mask
from rasterio.transform import from_bounds
import os

def recortar_tif_juarez():
    # Ruta al archivo TIF correcto que acabas de recibir
    tif_entrada = r"D:\sistema_inundaciones_juarez\rainfall_filtered_tif_test2\rainfall_filtered_tif_test2_moved.tif"
    shp_colonias = "SHP/Colonias/Colonias.shp"
    tif_salida = "static/data/lluvia_juarez_recortada.tif"

    if not os.path.exists("static/data"): os.makedirs("static/data")

    print("Calculando extensión de Juárez...")
    df = gpd.read_file(shp_colonias)
    bounds = df.total_bounds # [minx, miny, maxx, maxy]

    with rasterio.open(tif_entrada) as src:
        # Alineamos el TIF a las coordenadas del SHP
        new_transform = from_bounds(bounds[0], bounds[1], bounds[2], bounds[3], src.width, src.height)
        data = src.read(1)
        
        meta = src.meta.copy()
        meta.update({
            "driver": "GTiff", "height": src.height, "width": src.width,
            "transform": new_transform, "crs": "EPSG:4326"
        })

        temp_path = "static/data/temp_geo.tif"
        with rasterio.open(temp_path, "w", **meta) as tmp:
            tmp.write(data, 1)

    with rasterio.open(temp_path) as src_geo:
        out_image, out_transform = mask(src_geo, df.geometry, crop=True)
        out_meta = src_geo.meta.copy()
        out_meta.update({
            "height": out_image.shape[1], "width": out_image.shape[2],
            "transform": out_transform
        })
        with rasterio.open(tif_salida, "w", **out_meta) as dest:
            dest.write(out_image)

    if os.path.exists(temp_path): os.remove(temp_path)
    print(f"Éxito: Archivo optimizado en {tif_salida}")

if __name__ == "__main__":
    recortar_tif_juarez()