/**
 * Leaflet.jsを用いた地図描画・操作の管理クラス
 */
class MapManager {
    // ダークマップ向けの鮮やかなカラーパレット
    static ROAD_COLORS = [
        '#6366f1', // indigo
        '#f59e0b', // amber
        '#10b981', // emerald
        '#ef4444', // red
        '#8b5cf6', // violet
        '#06b6d4', // cyan
        '#f97316', // orange
        '#ec4899', // pink
        '#14b8a6', // teal
        '#a855f7', // purple
        '#22d3ee', // light cyan
        '#84cc16', // lime
        '#fb923c', // light orange
        '#c084fc', // light purple
    ];

    constructor(containerId) {
        this.map = L.map(containerId, {
            zoomControl: false // デフォルトのZoomを消して右下に配置する
        }).setView([35.681236, 139.767125], 6); // Default: Tokyo
        
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // ダークテーマ風のOpenStreetMapタイルを使用
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);

        this.routeLayer = null;        // 互換性のための単一ルート参照
        this.routeSegments = [];       // 色分けセグメントのポリライン配列
        this.roadLabels = [];          // 道路名ラベルのマーカー
        this.alternativeLayers = [];   // 代替ルートのポリライン
        this.weatherMarkers = [];
    }

    /**
     * 経路（ポリライン）を描画します（ステップなしの場合のフォールバック）
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
     * ステップ情報を元に色分けされた経路を描画し、道路名ラベルを配置する
     * @param {Array} steps - RoutingProviderから返されるステップ配列
     * @param {Object} fitOptions - LeafletのfitBoundsオプション
     * @returns {Object} colorMap - 道路名→色のマッピング（凡例表示用）
     */
    drawRouteWithSegments(steps, fitOptions = { padding: [50, 50] }) {
        // 既存クリア
        this.clearRouteSegments();

        // 連続する同名道路をグループ化
        const groups = this.#groupConsecutiveSteps(steps);

        // 道路名→色のマッピングを構築
        const colorMap = {};
        let colorIdx = 0;
        groups.forEach(g => {
            const key = g.displayName;
            if (key && !colorMap[key]) {
                colorMap[key] = MapManager.ROAD_COLORS[colorIdx % MapManager.ROAD_COLORS.length];
                colorIdx++;
            }
        });

        const allCoords = [];
        const segmentPolylines = [];

        groups.forEach(group => {
            if (group.geometry.length < 2) return;

            const color = (group.displayName && colorMap[group.displayName])
                || '#64748b'; // 無名道路のデフォルト色

            const polyline = L.polyline(group.geometry, {
                color: color,
                weight: 6,
                opacity: 0.85,
                lineJoin: 'round',
                className: 'interactive-polyline'
            }).addTo(this.map);

            this.routeSegments.push(polyline);
            segmentPolylines.push(polyline);
            allCoords.push(...group.geometry);
        });

        // routeLayer をLayerGroupとして設定（クリックイベント用の互換性）
        this.routeLayer = L.layerGroup(segmentPolylines);

        // ルート全体が見えるようにズームを調整
        if (allCoords.length > 0) {
            const bounds = L.latLngBounds(allCoords);
            this.map.fitBounds(bounds, fitOptions);
        }

        return colorMap;
    }

    /**
     * 代替ルートを地図上に描画する
     * @param {Array} alternatives - 代替ルートのデータ配列
     * @param {Function} onSelect - クリック時のコールバック (index) => void
     */
    drawAlternativeRoutes(alternatives, onSelect) {
        this.clearAlternatives();

        alternatives.forEach((alt, index) => {
            const polyline = L.polyline(alt.routeCoordinates, {
                color: '#94a3b8',
                weight: 4,
                opacity: 0.35,
                dashArray: '8, 8',
                lineJoin: 'round',
                className: 'alternative-route-polyline'
            }).addTo(this.map);

            // ホバーでハイライト
            polyline.on('mouseover', () => {
                polyline.setStyle({ opacity: 0.7, weight: 6, color: '#cbd5e1' });
            });
            polyline.on('mouseout', () => {
                polyline.setStyle({ opacity: 0.35, weight: 4, color: '#94a3b8' });
            });

            // クリックで選択
            polyline.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (onSelect) onSelect(index);
            });

            // ルート中央にラベル
            const midIdx = Math.floor(alt.routeCoordinates.length / 2);
            const midPoint = alt.routeCoordinates[midIdx];
            const distKm = (alt.distance / 1000).toFixed(1);
            const durH = Math.floor(alt.duration / 3600);
            const durM = Math.floor((alt.duration % 3600) / 60);
            const durStr = durH > 0 ? `${durH}h${durM}m` : `${durM}m`;

            const labelIcon = L.divIcon({
                className: 'alt-route-label',
                html: `<div class="alt-label-inner">代替 ${index + 1}<br>${distKm}km / ${durStr}</div>`,
                iconSize: [0, 0]
            });

            const marker = L.marker(midPoint, {
                icon: labelIcon,
                interactive: true,
                zIndexOffset: -200
            }).addTo(this.map);

            marker.on('click', () => {
                if (onSelect) onSelect(index);
            });

            this.alternativeLayers.push(polyline);
            this.alternativeLayers.push(marker);
        });
    }

    /**
     * 天気情報のマーカーを地図上に配置します
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
     */
    flyToWithOffset(latlng, zoom, offsetPx) {
        const targetPoint = this.map.project(latlng, zoom).subtract([0, offsetPx]);
        const targetLatLng = this.map.unproject(targetPoint, zoom);
        this.map.flyTo(targetLatLng, zoom, { duration: 0.5 });
    }

    /**
     * 連続する同名のステップをグループ化する
     */
    #groupConsecutiveSteps(steps) {
        const groups = [];
        let current = null;

        steps.forEach(step => {
            const name = step.name || '';
            const ref = step.ref || '';
            const displayName = name
                ? (ref ? `${name} (${ref})` : name)
                : (ref ? `(${ref})` : '');

            if (current && current.displayName === displayName) {
                // 同名の連続するステップ → ジオメトリを結合（始点の重複を除去）
                if (step.geometry.length > 0) {
                    const merged = step.geometry.slice(current.geometry.length > 0 ? 1 : 0);
                    current.geometry.push(...merged);
                }
                current.totalDistance += step.distance;
                current.totalDuration += step.duration;
            } else {
                // 新しいグループ
                current = {
                    displayName,
                    name,
                    ref,
                    geometry: [...step.geometry],
                    totalDistance: step.distance,
                    totalDuration: step.duration,
                    isToll: step.isToll
                };
                groups.push(current);
            }
        });

        return groups;
    }

    clearRouteSegments() {
        this.routeSegments.forEach(s => this.map.removeLayer(s));
        this.routeSegments = [];
        this.roadLabels.forEach(m => this.map.removeLayer(m));
        this.roadLabels = [];
        if (this.routeLayer) {
            // LayerGroupの場合は既にセグメントで削除済みだが念のため
            if (this.routeLayer.remove) {
                try { this.map.removeLayer(this.routeLayer); } catch(e) { /* ignore */ }
            }
            this.routeLayer = null;
        }
    }

    clearAlternatives() {
        this.alternativeLayers.forEach(l => this.map.removeLayer(l));
        this.alternativeLayers = [];
    }

    clear() {
        this.clearRouteSegments();
        this.clearAlternatives();
        if (this.routeLayer) {
            this.map.removeLayer(this.routeLayer);
            this.routeLayer = null;
        }
        this.weatherMarkers.forEach(m => this.map.removeLayer(m));
        this.weatherMarkers = [];
    }
}
