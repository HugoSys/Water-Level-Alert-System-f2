// Configuración Global
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

// Capas
let radarActive = false;
const capaRadar = L.tileLayer.wms("https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi", {
    layers: 'nexrad-n0r-900913',
    format: 'image/png',
    transparent: true,
    opacity: 0.65
});
const capaColonias = L.layerGroup().addTo(map);

// Lógica de Interfaz
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

// Clima y Lottie
let animacionClima = null;

async function obtenerClimaJuarez() {
    try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=31.7333&longitude=-106.4833&current_weather=true&timezone=America/Denver');
        const data = await res.json();
        const clima = data.current_weather;
        
        document.getElementById('weather-temp').innerText = `${clima.temperature}°C`;
        document.getElementById('weather-details').innerText = `Viento: ${clima.windspeed} km/h`;
        
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

// Sincronización con Backend
async function sincronizarSistema() {
    try {
        const res = await fetch('/estado');
        const data = await res.json();
        
        if(data.ultima_actualizacion.includes(' ')) {
            document.getElementById('hora-display').innerText = data.ultima_actualizacion.split(' ')[1];
        }

        // Lógica de Colonias
        if (capaColonias.getLayers().length === 0) {
            const resC = await fetch('/mapa-colonias');
            const geojsonC = await resC.json();
            L.geoJSON(geojsonC, {
                style: (f) => {
                    const info = data.colonias_criticas.find(c => c.nombre.toUpperCase() === (f.properties.NOMBRE || "").toUpperCase());
                    const v = info ? info.intensidad : 0;
                    return { 
                        fillColor: v > 30 ? '#ef4444' : v > 15 ? '#f59e0b' : v > 5 ? '#eab308' : v > 0.1 ? '#10b981' : '#38bdf8', 
                        weight: 1, color: 'white', fillOpacity: v > 0 ? 0.6 : 0.15 
                    };
                },
                onEachFeature: (f, layer) => {
                    const p = f.properties;
                    layer.bindPopup(`<div class="popup-header">${p.NOMBRE}</div><div class="infra-grid"><div class="infra-box">🏥 Hosp: ${p.hospitales || 0}</div><div class="infra-box">🎓 Esc: ${p.escuelas || 0}</div></div>`);
                }
            }).addTo(capaColonias);
        }

        // Lista de Riesgo
        const lista = document.getElementById('lista-colonias');
        lista.innerHTML = data.colonias_criticas.length > 0 ? 
            data.colonias_criticas.map(c => `<div class="colonia-card"><b>${c.nombre}</b><span>RIESGO: ${c.intensidad} mm/hr</span></div>`).join('') :
            `<div class="status-container"><div class="status-ok">● CIUDAD SIN NOVEDAD</div></div>`;
            
    } catch (err) { console.error("Error sync:", err); }
}

// Inicio
obtenerClimaJuarez();
setInterval(obtenerClimaJuarez, 1800000);
sincronizarSistema();
setInterval(sincronizarSistema, 15000);