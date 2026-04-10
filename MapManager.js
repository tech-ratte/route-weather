/**
 * Leaflet.jsを用いた地図描画・操作の管理クラス
 */
class MapManager {
    constructor(containerId) {
        this.map = L.map(containerId, {
            zoomControl: false // デフォルトのZoomを消して右下に配置する
        }).setView([35.681236, 139.767125], 6); // Default: Tokyo
        
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // ダークテーマ風のOpenStreetMapタイルを使用
        // CartoDB Dark Matter が一番美しいため使用（リファレンス用無料タイル）
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);

        this.routeLayer = null;
        this.weatherMarkers = [];
    }

    /**
     * 経路（ポリライン）を描画します
     * @param {Array<[number, number]>} routeCoords 
     * @param {Object} fitOptions LeafletのfitBoundsオプション
     */
    drawRoute(routeCoords, fitOptions = { padding: [50, 50] }) {
        // 既存のルートを削除
        if (this.routeLayer) {
            this.map.removeLayer(this.routeLayer);
        }

        // 新しいルートを描画
        this.routeLayer = L.polyline(routeCoords, {
            color: '#6366f1',
            weight: 5,
            opacity: 0.8,
            lineJoin: 'round',
            className: 'interactive-polyline'
        }).addTo(this.map);

        // ルート全体が見えるようにズームを調整
        this.map.fitBounds(this.routeLayer.getBounds(), fitOptions);
    }

    /**
     * 天気情報のマーカーを地図上に配置します
     * @param {Array} weatherDataList 
     * @param {Object} weatherService 
     */
    drawWeatherMarkers(weatherDataList, weatherService) {
        // 既存のマーカーを削除
        this.weatherMarkers.forEach(m => this.map.removeLayer(m));
        this.weatherMarkers = [];

        weatherDataList.forEach(data => {
            const wInfo = weatherService.getWeatherIcon(data.weathercode);
            
            // HTMLを利用したカスタムアイコン
            const customIcon = L.divIcon({
                className: 'custom-weather-icon',
                html: `<div style="font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">${wInfo.icon}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

            const marker = L.marker(data.location, { icon: customIcon }).addTo(this.map);
            
            // ポップアップの設定
            const popupContent = `
                <div class="popup-custom-title">${data.label}</div>
                <div class="popup-custom-data">
                    ${wInfo.icon} ${wInfo.text} / <span style="font-weight:bold">${data.temperature}°C</span>
                </div>
            `;
            marker.bindPopup(popupContent);
            this.weatherMarkers.push(marker);
        });
    }

    /**
     * 指定した座標を、画面中心からオフセットした位置に表示するように移動します
     * @param {Array<number, number>} latlng 
     * @param {number} zoom 
     * @param {number} offsetPx Y方向のオフセット（正の値で下へ移動）
     */
    flyToWithOffset(latlng, zoom, offsetPx) {
        // 現在のズームレベルまたは指定のズームレベルで座標をピクセルに変換
        const targetPoint = this.map.project(latlng, zoom).subtract([0, offsetPx]);
        const targetLatLng = this.map.unproject(targetPoint, zoom);
        this.map.flyTo(targetLatLng, zoom, { duration: 0.5 });
    }

    clear() {
        if (this.routeLayer) {
            this.map.removeLayer(this.routeLayer);
            this.routeLayer = null;
        }
        this.weatherMarkers.forEach(m => this.map.removeLayer(m));
        this.weatherMarkers = [];
    }
}
