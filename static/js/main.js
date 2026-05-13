// --- CONFIGURACIÓN GLOBAL ---
const COORDS_JUAREZ = [31.7333, -106.4833];
const BOUNDS_JUAREZ = [[31.4500, -106.6500], [31.8500, -106.3000]];

// Inicialización del Mapa
const map = L.map('map', { 
    zoomControl: false,
    maxBounds: BOUNDS_JUAREZ, 
    maxBoundsViscosity: 1.0, 
    minZoom: 4 
}).setView(COORDS_JUAREZ, 12);

L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO',
    noWrap: true 
}).addTo(map);

// --- CAPAS Y ESTADOS ---
let radarActive = false;
const capaRadar = L.tileLayer.wms("https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi", {
    layers: 'nexrad-n0r-900913',
    format: 'image/png',
    transparent: true,
    opacity: 0.65
});
const capaColonias = L.layerGroup().addTo(map);

// --- LÓGICA DE INTERFAZ ---
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('overlay').classList.toggle('active');
}

function toggleRadar() {
    radarActive = !radarActive;
    const btn = document.getElementById('btn-radar');
    if (radarActive) {
        capaRadar.addTo(map);
        btn.classList.add('active');
        btn.querySelector('span').innerText = "OCULTAR RADAR";
    } else {
        map.removeLayer(capaRadar);
        btn.classList.remove('active');
        btn.querySelector('span').innerText = "VISUALIZAR RADAR";
    }
}

// Colores unificados con el sistema de riesgo
function obtenerColorRiesgo(v) {
    if (v > 30) return '#ef4444'; // Rojo (Crítico)
    if (v > 15) return '#f59e0b'; // Naranja (Alto)
    if (v > 5)  return '#eab308'; // Amarillo (Medio)
    if (v > 0.1) return '#38bdf8'; // Celeste (Bajo)
    return 'rgba(255, 255, 255, 0.1)'; // Transparente/Gris en Sidebar Oscuro
}

// --- CLIMA Y LOTTIE ---
let animacionClima = null;

async function obtenerClimaJuarez() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=31.7333&longitude=-106.4833&current_weather=true&hourly=relative_humidity_2m,surface_pressure,cloud_cover,precipitation_probability&timezone=America/Denver';
        const res = await fetch(url);
        const data = await res.json();
        const clima = data.current_weather;
        
        // Actualizar UI Clima
        document.getElementById('weather-temp').innerText = `${clima.temperature}°C`;
        document.getElementById('weather-details').innerText = `Viento: ${clima.windspeed} km/h`;
        document.getElementById('stat-humidity').innerText = `${data.hourly.relative_humidity_2m[0]}%`;
        document.getElementById('stat-pressure').innerText = `${data.hourly.surface_pressure[0]} hPa`;
        document.getElementById('stat-clouds').innerText = `${data.hourly.cloud_cover[0]}%`;
        document.getElementById('stat-pop').innerText = `${data.hourly.precipitation_probability[0]}%`;

        // Lógica de Iconos Animados
        let lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_dgjK9i.json"; 
        let desc = "Nubosidad Parcial";
        
        if (clima.weathercode === 0) { lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_Stdaec.json"; desc = "Despejado"; }
        else if (clima.weathercode >= 51) { lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_rpC1Rd.json"; desc = "Precipitación Activa"; }

        document.getElementById('weather-desc').innerText = desc;
        
        if (animacionClima) animacionClima.destroy();
        animacionClima = lottie.loadAnimation({
            container: document.getElementById('weather-lottie'),
            renderer: 'svg', loop: true, autoplay: true, path: lottieUrl
        });

    } catch (error) { console.error("Error clima:", error); }
}

// --- SLIDER DE INTENSIDAD ---
async function cargarPrediccionLluvia() {
    try {
        const res = await fetch('/prediccion-lluvia');
        const result = await res.json();
        if (result.status === 'success') {
            dibujarTimeline(result.data);
        }
    } catch (e) { console.error("Error en timeline:", e); }
}

function dibujarTimeline(datos) {
    const track = document.getElementById('timeline-track');
    if (!track) return;
    track.innerHTML = ''; 

    datos.forEach(hora => {
        const segment = document.createElement('div');
        segment.className = 'timeline-segment';
        
        const mm = hora.mm || 0;
        const color = obtenerColorRiesgo(mm);

        segment.style.backgroundColor = color;
        segment.style.borderRight = '1px solid rgba(0,0,0,0.2)'; // División sutil
        
        const fecha = new Date(hora.hora);
        const horaTxt = fecha.getHours().toString().padStart(2, '0') + ":00";
        segment.setAttribute('data-info', `${horaTxt} | ${mm}mm | Prob: ${hora.probabilidad}%`);
        
        track.appendChild(segment);
    });
}

// --- SINCRONIZACIÓN CON BACKEND ---
async function sincronizarSistema() {
    try {
        const res = await fetch('/estado');
        const data = await res.json();
        
        // Actualizar hora en el Header
        if(data.ultima_actualizacion.includes(' ')) {
            document.getElementById('hora-display').innerText = data.ultima_actualizacion.split(' ')[1];
        }

        // Renderizar Colonias en el Mapa
        if (capaColonias.getLayers().length === 0) {
            const resC = await fetch('/mapa-colonias');
            const geojsonC = await resC.json();
            L.geoJSON(geojsonC, {
                style: (f) => {
                    const info = data.colonias_criticas.find(c => c.nombre.toUpperCase() === (f.properties.NOMBRE || "").toUpperCase());
                    const v = info ? info.intensidad : 0;
                    return { 
                        fillColor: obtenerColorRiesgo(v), weight: 1.5, color: 'white', fillOpacity: v > 0 ? 0.7 : 0.3 
                    };
                },
                onEachFeature: (f, layer) => {
                    const p = f.properties;
                    layer.bindPopup(`
                        <div style="font-family: 'Inter', sans-serif; min-width: 150px;">
                            <div style="font-weight: 800; border-bottom: 2px solid #38bdf8; padding-bottom: 4px; margin-bottom: 8px; text-transform: uppercase;">${p.NOMBRE}</div>
                            <div style="display: grid; grid-template-columns: 1fr; gap: 4px; font-size: 0.75rem;">
                                <span>🏥 Hospitales: <b>${p.hospitales || 0}</b></span>
                                <span>🎓 Escuelas: <b>${p.escuelas || 0}</b></span>
                                <span>🏠 C. Comunitarios: <b>${p.comunitarios || 0}</b></span>
                            </div>
                        </div>
                    `);
                }
            }).addTo(capaColonias);
        } else {
            capaColonias.eachLayer(layer => {
                if (layer.setStyle && layer.feature) {
                    const n = (layer.feature.properties.NOMBRE || "").toUpperCase();
                    const info = data.colonias_criticas.find(c => c.nombre.toUpperCase() === n);
                    const v = info ? info.intensidad : 0;
                    layer.setStyle({ fillColor: obtenerColorRiesgo(v), fillOpacity: v > 0 ? 0.7 : 0.3 });
                }
            });
        }

        // Lista Lateral de Riesgo
        const lista = document.getElementById('lista-colonias');
        lista.innerHTML = data.colonias_criticas.length > 0 ? 
            data.colonias_criticas.map(c => `
                <div class="colonia-card">
                    <b>${c.nombre}</b>
                    <span style="color:${obtenerColorRiesgo(c.intensidad)}">${c.intensidad} mm/hr</span>
                </div>`).join('') :
            `<div class="status-ok">● CIUDAD BAJO MONITOREO</div>`;
            
    } catch (err) { console.error("Error sync:", err); }
}

// --- INICIALIZACIÓN ---
obtenerClimaJuarez();
cargarPrediccionLluvia();
sincronizarSistema();

setInterval(obtenerClimaJuarez, 1800000);   
setInterval(cargarPrediccionLluvia, 1800000); 
setInterval(sincronizarSistema, 15000);
