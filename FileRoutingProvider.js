/**
 * ファイル (KML, GeoJSON) から経路をパースするプロバイダ
 */
class FileRoutingProvider extends RoutingProvider {
    
    constructor() {
        super();
        this.mode = 'driving';
    }

    setMode(mode) {
        if (['car', 'bicycle', 'foot'].includes(mode)) {
            this.mode = mode;
        }
    }

    /**
     * ファイルオブジェクトから経路情報を抽出する
     * @param {File} file 
     * @returns {Promise<{
     *   routeCoordinates: Array<[number, number]>,
     *   distance: number,
     *   duration: number,
     *   waypoints: Array<{name: string, location: [number, number]}>
     * }>}
     */
    async getRouteFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                const text = e.target.result;
                const fileName = file.name.toLowerCase();
                
                try {
                    let routeCoords = [];
                    if (fileName.endsWith('.kml')) {
                        routeCoords = this._parseKML(text);
                    } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
                        routeCoords = this._parseGeoJSON(text);
                    } else {
                        throw new Error("対応していないファイル形式です");
                    }
                    
                    if (routeCoords.length < 2) {
                        throw new Error("経路データが見つかりませんでした");
                    }
                    
                    const distance = this._calculateDistance(routeCoords);
                    
                    // 移動手段に基づく速度(m/s)で所要時間を計算
                    // 徒歩: 約5km/h (1.4m/s), 自転車: 約15km/h (4.2m/s), 車: 約40km/h (11.1m/s)
                    let speed = 11.1; 
                    if (this.mode === 'foot') speed = 1.4;
                    else if (this.mode === 'bicycle') speed = 4.2;

                    const duration = distance / speed; 
                    
                    const startLoc = routeCoords[0];
                    const endLoc = routeCoords[routeCoords.length - 1];

                    resolve({
                        routeCoordinates: routeCoords,
                        distance: distance,
                        duration: duration,
                        waypoints: [
                            { name: "スタート（ファイル起点）", location: startLoc },
                            { name: "ゴール（ファイル終点）", location: endLoc }
                        ]
                    });

                } catch (err) {
                    reject(err);
                }
            };
            
            reader.onerror = () => reject(new Error("ファイルの読み取りに失敗しました"));
            reader.readAsText(file);
        });
    }

    _parseKML(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        
        // Google My Maps のエクスポートKMLは <LineString><coordinates> を持つことが多い
        const coordsNodes = xmlDoc.getElementsByTagName("coordinates");
        
        // 最も長い座標リスト（メインルート）を探す
        let bestCoordsText = "";
        let maxLen = 0;
        
        for (let i = 0; i < coordsNodes.length; i++) {
            const text = coordsNodes[i].textContent.trim();
            if (text.length > maxLen) {
                maxLen = text.length;
                bestCoordsText = text;
            }
        }
        
        if (!bestCoordsText) {
            throw new Error("KML内にLineString座標が見つかりませんでした");
        }
        
        // "lng,lat,alt lng,lat,alt" 形式
        const coordsArray = bestCoordsText.split(/\s+/);
        const routeCoords = [];
        
        coordsArray.forEach(pair => {
            if (!pair) return;
            const parts = pair.split(',');
            if (parts.length >= 2) {
                const lng = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (!isNaN(lat) && !isNaN(lng)) {
                    routeCoords.push([lat, lng]); // Leaflet uses [lat, lng]
                }
            }
        });
        
        return routeCoords;
    }

    _parseGeoJSON(jsonText) {
        const data = JSON.parse(jsonText);
        let routeCoords = [];
        
        // 再帰的に深掘りしてLineStringを探す
        const findCoordinates = (obj) => {
            if (!obj) return;
            
            if (obj.type === "LineString" && obj.coordinates) {
                // GeoJSON uses [lng, lat]
                obj.coordinates.forEach(coord => {
                    routeCoords.push([coord[1], coord[0]]);
                });
                return true;
            }
            
            if (Array.isArray(obj.features)) {
                for (const feature of obj.features) {
                    if (findCoordinates(feature.geometry)) return true;
                }
            }
            return false;
        };
        
        findCoordinates(data);
        
        if (routeCoords.length === 0) {
            throw new Error("GeoJSON内にLineStringが見つかりませんでした");
        }
        
        return routeCoords;
    }

    // ハーベサイン公式による距離計算 (メートル)
    _calculateDistance(coords) {
        const R = 6371e3; // metres
        let total = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i+1];
            
            const lat1 = p1[0] * Math.PI/180;
            const lat2 = p2[0] * Math.PI/180;
            const deltaLat = (p2[0]-p1[0]) * Math.PI/180;
            const deltaLng = (p2[1]-p1[1]) * Math.PI/180;

            const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                      Math.cos(lat1) * Math.cos(lat2) *
                      Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            total += R * c;
        }
        return total;
    }
}
