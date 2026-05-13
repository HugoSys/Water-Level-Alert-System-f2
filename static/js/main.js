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

// --- CAPAS ---
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

// --- AUXILIARES ---
function obtenerColorRiesgo(v) {
    if (v > 30) return '#ef4444'; // Muy Alto
    if (v > 15) return '#f59e0b'; // Alto
    if (v > 5)  return '#eab308'; // Medio
    if (v > 0.1) return '#10b981'; // Bajo
    return '#f1f5f9'; // Relleno base (seco)
}

// --- CLIMA Y LOTTIE ---
let animacionClima = null;

async function obtenerClimaJuarez() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=31.7333&longitude=-106.4833&current_weather=true&hourly=relative_humidity_2m,surface_pressure,cloud_cover,precipitation_probability&timezone=America/Denver';
        const res = await fetch(url);
        const data = await res.json();
        const clima = data.current_weather;
        
        // Actualizar Weather Card
        document.getElementById('weather-temp').innerText = `${clima.temperature}°C`;
        document.getElementById('weather-details').innerText = `Viento: ${clima.windspeed} km/h`;
        
        // Actualizar Caja de Estadísticas Atmosféricas
        document.getElementById('stat-humidity').innerText = `${data.hourly.relative_humidity_2m[0]}%`;
        document.getElementById('stat-pressure').innerText = `${data.hourly.surface_pressure[0]} hPa`;
        document.getElementById('stat-clouds').innerText = `${data.hourly.cloud_cover[0]}%`;
        document.getElementById('stat-pop').innerText = `${data.hourly.precipitation_probability[0]}%`;

        // Lógica de Animación Lottie y Descripción
        let lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_dgjK9i.json";
        let desc = "Nubosidad Parcial";
        
        if (clima.weathercode === 0) { lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_Stdaec.json"; desc = "Despejado"; }
        else if (clima.weathercode >= 51 && clima.weathercode <= 82) { lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_rpC1Rd.json"; desc = "Precipitación Activa"; }
        else if (clima.weathercode >= 95) { lottieUrl = "https://assets3.lottiefiles.com/temp/lf20_Kuot2e.json"; desc = "Tormenta Eléctrica"; }

        document.getElementById('weather-desc').innerText = desc;
        
        if (animacionClima) animacionClima.destroy();
        animacionClima = lottie.loadAnimation({
            container: document.getElementById('weather-lottie'),
            renderer: 'svg', loop: true, autoplay: true, path: lottieUrl
        });

    } catch (error) { console.error("Error clima:", error); }
}

// --- PREDICCIÓN OPEN-METEO (CHART.JS) ---
let chartPrediccion = null;

async function cargarPrediccionLluvia() {
    try {
        const res = await fetch('/prediccion-lluvia');
        const result = await res.json();
        
        if (result.status === 'success') {
            renderizarGrafica(result.data);
        }
    } catch (error) {
        console.error("Error al obtener la predicción de lluvia:", error);
    }
}

function renderizarGrafica(datos) {
    const ctx = document.getElementById('graficaPrediccion');
    if (!ctx) return;

    // Formatear datos para Chart.js
    const etiquetasHora = datos.map(d => {
        const fecha = new Date(d.hora);
        return fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    const datosMm = datos.map(d => d.mm);
    const datosProb = datos.map(d => d.probabilidad);

    // Destruir gráfica previa para evitar superposición visual
    if (chartPrediccion) {
        chartPrediccion.destroy();
    }

    chartPrediccion = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetasHora,
            datasets: [
                {
                    label: 'Lluvia (mm)',
                    data: datosMm,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    yAxisID: 'y' 
                },
                {
                    label: 'Probabilidad (%)',
                    data: datosProb,
                    type: 'line',
                    borderColor: 'rgba(239, 68, 68, 1)',
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'y1' 
                }
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    type: 'linear', display: true, position: 'left',
                    title: { display: true, text: 'Milímetros (mm)' }
                },
                y1: {
                    type: 'linear', display: true, position: 'right', min: 0, max: 100,
                    title: { display: true, text: 'Probabilidad (%)' },
                    grid: { drawOnChartArea: false } 
                }
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12 } }
            }
        }
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

        // Lógica de Colonias en el Mapa
        if (capaColonias.getLayers().length === 0) {
            const resC = await fetch('/mapa-colonias');
            const geojsonC = await resC.json();
            L.geoJSON(geojsonC, {
                style: (f) => {
                    const info = data.colonias_criticas.find(c => c.nombre.toUpperCase() === (f.properties.NOMBRE || "").toUpperCase());
                    const v = info ? info.intensidad : 0;
                    return { 
                        fillColor: obtenerColorRiesgo(v), 
                        weight: 2.5, 
                        color: 'white', 
                        fillOpacity: v > 0 ? 0.75 : 0.4 
                    };
                },
                onEachFeature: (f, layer) => {
                    const p = f.properties;
                    layer.bindPopup(`<div class="popup-header">${p.NOMBRE}</div><div class="infra-grid"><div class="infra-box">🏥 Hosp: ${p.hospitales || 0}</div><div class="infra-box">🎓 Esc: ${p.escuelas || 0}</div></div>`);
                }
            }).addTo(capaColonias);
        } else {
            capaColonias.eachLayer(layer => {
                if (layer.setStyle && layer.feature) {
                    const n = (layer.feature.properties.NOMBRE || "").toUpperCase();
                    const info = data.colonias_criticas.find(c => c.nombre.toUpperCase() === n);
                    const v = info ? info.intensidad : 0;
                    layer.setStyle({
                        fillColor: obtenerColorRiesgo(v),
                        fillOpacity: v > 0 ? 0.75 : 0.4
                    });
                }
            });
        }

        // Lista de Riesgo en el Panel Lateral
        const lista = document.getElementById('lista-colonias');
        lista.innerHTML = data.colonias_criticas.length > 0 ? 
            data.colonias_criticas.map(c => `<div class="colonia-card"><b>${c.nombre}</b><span>RIESGO: ${c.intensidad} mm/hr</span></div>`).join('') :
            `<div class="status-container"><div class="status-ok">● CIUDAD SIN NOVEDAD</div></div>`;
            
    } catch (err) { console.error("Error sync:", err); }
}

// --- INICIALIZACIÓN ---
obtenerClimaJuarez();
cargarPrediccionLluvia(); // Se lanza al inicio
setInterval(obtenerClimaJuarez, 1800000); // Cada 30 min
setInterval(cargarPrediccionLluvia, 1800000); // Cada 30 min
sincronizarSistema();
setInterval(sincronizarSistema, 15000); // Cada 15 seg
