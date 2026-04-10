/**
 * 汎用的なRoutingProviderのベースクラス。
 * Google Maps等、将来的なプロバイダ追加時にこのインターフェースを実装します。
 */
class RoutingProvider {
    /**
     * @param {string} startName 
     * @param {string} endName 
     * @returns {Promise<{
     *   routeCoordinates: Array<[number, number]>, // [lat, lng] array
     *   distance: number, // in meters
     *   duration: number, // in seconds
     *   waypoints: Array<{name: string, location: [number, number]}>
     * }>}
     */
    async getRoute(startName, endName) {
        throw new Error("Not implemented");
    }
}

/**
 * OpenStreetMap (Nominatim) と OSRM を利用した無料のプロバイダ実装。
 */
class OsrmRoutingProvider extends RoutingProvider {
    constructor() {
        super();
        this.mode = 'driving'; // default
    }

    setMode(mode) {
        if (['driving', 'cycling', 'walking'].includes(mode)) {
            this.mode = mode;
        }
    }

    // 住所から座標(lat, lng)に変換する (Nominatim API)
    async #geocode(address) {
        // もしaddressが既に「緯度,経度」の形式ならNominatimをスキップする
        const coordMatch = address.match(/^([+-]?\d+\.\d+),\s*([+-]?\d+\.\d+)$/);
        if (coordMatch) {
            return {
                name: "指定座標",
                location: [parseFloat(coordMatch[1]), parseFloat(coordMatch[2])]
            };
        }

        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
        const res = await fetch(url, {
            headers: {
                'Accept-Language': 'ja'
            }
        });
        if (!res.ok) throw new Error("Geocoding failed");
        
        const data = await res.json();
        if (data.length === 0) {
            throw new Error(`場所が見つかりませんでした: ${address}`);
        }
        
        return {
            name: data[0].display_name,
            location: [parseFloat(data[0].lat), parseFloat(data[0].lon)]
        };
    }

    async getRoute(waypointsList) {
        if (!Array.isArray(waypointsList) || waypointsList.length < 2) {
            throw new Error("出発地と目的地の少なくとも2つの地点が必要です");
        }

        // 1. 各地点の座標を取得
        const points = [];
        for (const name of waypointsList) {
            points.push(await this.#geocode(name));
        }
        
        // 2. 経路を取得 (OSRM requires coordinates joined by ;)
        const routeInfo = await this.#fetchRouteMulti(points.map(p => p.location));
        
        return {
            ...routeInfo,
            waypoints: points,
            duration: routeInfo.duration
        };
    }

    async getRouteFromCoords(coordsArray, namesArray = null) {
        const points = coordsArray.map((coord, i) => {
            let name = namesArray ? namesArray[i] : (i === 0 ? "出発地" : i === coordsArray.length - 1 ? "目的地" : `経由地 ${i}`);
            return { name, location: coord };
        });
        
        const routeInfo = await this.#fetchRouteMulti(points.map(p => p.location));
        
        return {
            ...routeInfo,
            waypoints: points,
            duration: routeInfo.duration
        };
    }

    async #fetchRouteMulti(locations) {
        // locations is array of [lat, lng]
        // OSRM requires lon,lat format separated by ;
        const coordsStr = locations.map(loc => `${loc[1]},${loc[0]}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/${this.mode}/${coordsStr}?overview=full&geometries=geojson`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error("Routing failed");
        
        const data = await res.json();
        if (data.code !== "Ok") throw new Error("ルートが見つかりませんでした");

        const route = data.routes[0];
        const routeCoordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        
        return {
            routeCoordinates,
            distance: route.distance,
            duration: route.duration
        };
    }
}
