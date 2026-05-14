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

// --- UTILIDADES ---

/**
 * Limpia el texto para comparaciones seguras (quita acentos, espacios y pasa a mayúsculas)
 */
function normalizarTexto(t) {
    if (!t) return "";
    return String(t).toUpperCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function obtenerColorRiesgo(v) {
    if (v > 30) return '#ef4444'; // Rojo (Crítico)
    if (v > 15) return '#f59e0b'; // Naranja (Alto)
    if (v > 5)  return '#eab308'; // Amarillo (Medio)
    if (v > 0.1) return '#38bdf8'; // Celeste (Bajo)
    return 'rgba(255, 255, 255, 0.1)'; // Neutro
}

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

// --- SISTEMA DE ALERTAS CRÍTICAS ---
function verificarAlertasCriticas(datos) {
    const banner = document.getElementById('emergency-banner');
    const mensaje = document.getElementById('emergency-message');
    
    const horaCritica = datos.find(d => d.mm > 25);
    
    if (horaCritica) {
        const fecha = new Date(horaCritica.hora);
        const horaTxt = fecha.getHours().toString().padStart(2, '0') + ":00";
        mensaje.innerText = `ALERTA CRÍTICA: Tormenta severa detectada (Impacto estimado: ${horaTxt})`;
        banner.classList.add('active');
        document.querySelector('.header').style.background = '#991b1b'; 
    } else {
        if (banner) banner.classList.remove('active');
        document.querySelector('.header').style.background = '#1e293b'; 
    }
}

// --- CLIMA ACTUAL ---
let animacionClima = null;

async function obtenerClimaJuarez() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=31.7333&longitude=-106.4833&current_weather=true&hourly=relative_humidity_2m,surface_pressure,cloud_cover,precipitation_probability&timezone=America/Denver';
        const res = await fetch(url);
        const data = await res.json();
        const clima = data.current_weather;
        
        document.getElementById('weather-temp').innerText = `${clima.temperature}°C`;
        document.getElementById('weather-details').innerText = `Viento: ${clima.windspeed} km/h`;
        document.getElementById('stat-humidity').innerText = `${data.hourly.relative_humidity_2m[0]}%`;
        document.getElementById('stat-pressure').innerText = `${data.hourly.surface_pressure[0]} hPa`;
        document.getElementById('stat-clouds').innerText = `${data.hourly.cloud_cover[0]}%`;
        document.getElementById('stat-pop').innerText = `${data.hourly.precipitation_probability[0]}%`;

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

// --- TIMELINE ---
async function cargarPrediccionLluvia() {
    try {
        const res = await fetch('/prediccion-lluvia');
        const result = await res.json();
        if (result.status === 'success') {
            dibujarTimeline(result.data);
            verificarAlertasCriticas(result.data);
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
        segment.style.backgroundColor = obtenerColorRiesgo(mm);
        segment.style.borderRight = '1px solid rgba(0,0,0,0.2)'; 
        
        const fecha = new Date(hora.hora);
        const horaTxt = fecha.getHours().toString().padStart(2, '0') + ":00";
        segment.setAttribute('data-info', `${horaTxt} | ${mm}mm | Prob: ${hora.probabilidad}%`);
        track.appendChild(segment);
    });
}

// --- SINCRONIZACIÓN Y MAPA ---
async function sincronizarSistema() {
    try {
        const res = await fetch('/estado');
        const data = await res.json();
        
        if(data.ultima_actualizacion.includes(' ')) {
            document.getElementById('hora-display').innerText = data.ultima_actualizacion.split(' ')[1];
        }

        if (capaColonias.getLayers().length === 0) {
            const resC = await fetch('/mapa-colonias');
            const geojsonC = await resC.json();
            L.geoJSON(geojsonC, {
                style: (f) => {
                    const n = normalizarTexto(f.properties.NOMBRE);
                    const info = data.colonias_criticas.find(c => normalizarTexto(c.nombre) === n);
                    const v = info ? info.intensidad : 0;
                    return { 
                        fillColor: obtenerColorRiesgo(v), 
                        weight: 0.5, 
                        color: '#0000005d', 
                        fillOpacity: v > 0 ? 0.7 : 0.2 
                    };
                },
                onEachFeature: (f, layer) => {
                    const p = f.properties;
            layer.bindPopup(`
    <div style="font-family: 'Inter', sans-serif; min-width: 160px; color: var(--text-main);">
        <!-- Título de la Colonia -->
        <div style="font-weight: 800; border-bottom: 2px solid var(--accent); padding-bottom: 6px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${p.NOMBRE}
        </div>
        
        <!-- Indicadores (Hospitales, Escuelas y Centros Comunitarios) -->
        <div style="font-size: 0.75rem; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
            <div style="display: flex; align-items: center; gap: 3px;">
                <span style="filter: brightness(1.2);">🏥</span> 
                <span>Hosp: ${p.hospitales || 0}</span>
            </div>
            
            <span style="color: var(--border-dark);">|</span>
            
            <div style="display: flex; align-items: center; gap: 3px;">
                <span style="filter: brightness(1.2);">🎓</span> 
                <span>Esc: ${p.escuelas || 0}</span>
            </div>

            <span style="color: var(--border-dark);">|</span>

            <div style="display: flex; align-items: center; gap: 3px;">
                <span>🏠</span> 
                <span>CC: ${p.centros || 0}</span>
            </div>
        </div>
    </div>
`);
                }
            }).addTo(capaColonias);
        }
    } catch (err) { console.error("Error sync:", err); }
}

// --- MOTOR DE SIMULACIÓN TIF ---
async function simularTormenta() {
    console.log("Iniciando simulación desde TIF...");
    try {
        const res = await fetch('/simular-tif');
        const result = await res.json();
        
        if (result.status === 'success') {
            const mmMaximo = result.max_mm; 
            const afectadas = result.colonias_afectadas || [];

            // 1. Forzar actualización del Timeline para reflejar la simulación
            const ahora = new Date();
            const datosSim = Array.from({ length: 24 }, (_, i) => {
                const hSim = new Date(ahora.getTime() + (i * 3600000));
                let mm = (i >= 3 && i <= 6) ? mmMaximo : (i > 6 && i < 9 ? mmMaximo / 2 : 0);
                return { hora: hSim.toISOString(), mm: mm, probabilidad: 95 };
            });
            dibujarTimeline(datosSim);
            verificarAlertasCriticas(datosSim);

            // 2. Pintado del Mapa por Colonia
            let matches = 0;
            capaColonias.eachLayer(layer => {
                // Leaflet geoJSON layers can have sub-layers
                layer.eachLayer(subLayer => {
                    if (subLayer.feature) {
                        const nMapa = normalizarTexto(subLayer.feature.properties.NOMBRE);
                        const lluvia = afectadas.find(c => normalizarTexto(c.nombre) === nMapa);
                        
                        if (lluvia) {
                            matches++;
                            subLayer.setStyle({ 
                                fillColor: obtenerColorRiesgo(lluvia.intensidad), 
                                fillOpacity: 0.85, 
                                weight: 2.5,
                                color: '#ffffff'
                            });
                        } else {
                            subLayer.setStyle({ fillOpacity: 0.05, weight: 0.2 });
                        }
                    }
                });
            });

            alert(`Simulación procesada.\nImpacto máximo: ${mmMaximo}mm.\nColonias afectadas en mapa: ${matches}`);
        } else {
            alert("Error: " + result.detail);
        }
    } catch (error) { console.error("Error en simulación:", error); }
}

// --- INICIALIZACIÓN ---
obtenerClimaJuarez();
cargarPrediccionLluvia();
sincronizarSistema();

setInterval(obtenerClimaJuarez, 1800000); 
setInterval(sincronizarSistema, 30000);rec
