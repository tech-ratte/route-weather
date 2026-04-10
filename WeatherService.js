/**
 * 経路周辺の天気を取得するためのサービス (Open-Meteo APIを利用)
 */
class WeatherService {
    
    /**
     * 経路情報から一定間隔のポイントをサンプリングして天気を取得します
     * @param {Array<[number, number]>} routeCoordinates - [lat, lng]
     * @param {number} pointsCount - 取得するポイント数（デフォルト5）
     * @param {Date} targetDate - 天気を取得する出発時の日時（指定がない場合は現在）
     * @param {number} totalDurationSeconds - 経路の総所要時間（秒）
     * @returns {Promise<Array>} weather data
     */
    async getWeatherAlongRoute(routeCoordinates, pointsCount = 5, targetDate = null, totalDurationSeconds = 0) {
        if (!routeCoordinates || routeCoordinates.length === 0) return [];

        const sampledPoints = this.#samplePoints(routeCoordinates, pointsCount);
        const results = [];

        // 基準時刻。未指定なら現在
        const baseTimeMs = targetDate ? targetDate.getTime() : Date.now();

        for (let i = 0; i < sampledPoints.length; i++) {
            const point = sampledPoints[i];
            
            // 進捗割合からこのポイントの通過予想時刻を計算
            const fraction = i / (sampledPoints.length - 1);
            const timeOffsetMs = fraction * totalDurationSeconds * 1000;
            const pointTime = new Date(baseTimeMs + timeOffsetMs);

            try {
                // ラベルの決定
                let label = "経由地";
                if (i === 0) label = "出発地付近";
                else if (i === sampledPoints.length - 1) label = "目的地付近";

                // 単発で天気を取得する処理へ委譲
                const data = await this.getSinglePointWeather(point, pointTime, label);
                results.push(data);
                
                // 逆ジオコーディングのAPIリミットを回避するための待機 (1秒)
                if (i < sampledPoints.length - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                }

            } catch (err) {
                console.error("Failed to fetch weather for point:", point, err);
            }
        }
        
        return results;
    }

    /**
     * 単一のポイントの天気・地名を取得します（経路クリック等でも利用）
     */
    async getSinglePointWeather(point, pointTime, baseLabel = "指定ポイント") {
        let weatherData = null;

        // Hourly Forecast API (日時から一番近い時間のデータを取得)
        const isoDate = pointTime.toISOString().split('T')[0]; // YYYY-MM-DD
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${point[0]}&longitude=${point[1]}&hourly=temperature_2m,weathercode&timezone=auto&start_date=${isoDate}&end_date=${isoDate}`;
        const res = await fetch(url);
        
        if (res.ok) {
            const data = await res.json();
            if (data.hourly && data.hourly.time) {
                let closestIdx = 0;
                let minDiff = Infinity;
                const targetTimeMs = pointTime.getTime();
                
                data.hourly.time.forEach((tStr, idx) => {
                    const t = new Date(tStr).getTime();
                    const diff = Math.abs(t - targetTimeMs);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = idx;
                    }
                });

                weatherData = {
                    temperature: data.hourly.temperature_2m[closestIdx],
                    weathercode: data.hourly.weathercode[closestIdx],
                    time: data.hourly.time[closestIdx]
                };
            }
        }

        // fallback to current weather
        if (!weatherData) {
            const urlCurr = `https://api.open-meteo.com/v1/forecast?latitude=${point[0]}&longitude=${point[1]}&current_weather=true`;
            const resCurr = await fetch(urlCurr);
            if (!resCurr.ok) throw new Error("Weather fetch failed");
            const dataCurr = await resCurr.json();
            weatherData = dataCurr.current_weather;
        }

        // 逆ジオコーディング
        let label = baseLabel;
        const placeName = await this.#reverseGeocode(point[0], point[1]);
        if (placeName) {
            if (label.includes("付近") || label.includes("ポイント")) {
                label = `${label} (${placeName})`;
            } else {
                label = placeName;
            }
        }

        return {
            location: point,
            label,
            temperature: weatherData.temperature,
            weathercode: weatherData.weathercode,
            time: weatherData.time,
            expectedTime: pointTime // 念のため予想時刻も保持
        };
    }

    /**
     * 座標から大まかな地名を逆引きする（市区町村レベル）
     */
    async #reverseGeocode(lat, lng) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=ja`;
            const res = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
            if (!res.ok) return null;
            const data = await res.json();
            
            if (data && data.address) {
                // 最も特徴的で短めの名前を探す（市区町村）
                const addr = data.address;
                const name = addr.city || addr.town || addr.village || addr.suburb || addr.county || addr.province || addr.state;
                return name ? name : null;
            }
        } catch (e) {
            console.error("Reverse geocoding error:", e);
        }
        return null;
    }

    // 経路から指定数のポイントを等間隔でサンプリング
    #samplePoints(coords, count) {
        if (coords.length <= count) return coords;
        
        const step = (coords.length - 1) / (count - 1);
        const points = [];
        
        for (let i = 0; i < count; i++) {
            const index = Math.min(Math.round(i * step), coords.length - 1);
            points.push(coords[index]);
        }
        
        return points;
    }

    /**
     * WMO Weather codeからアイコン文字への変換
     */
    getWeatherIcon(code) {
        const descMap = {
            0: { icon: '☀️', text: '快晴' },
            1: { icon: '🌤️', text: '晴れ' },
            2: { icon: '⛅', text: '一部曇り' },
            3: { icon: '☁️', text: '曇り' },
            45: { icon: '🌫️', text: '霧' },
            48: { icon: '🌫️', text: '霧氷' },
            51: { icon: '🌧️', text: '小雨' },
            53: { icon: '🌧️', text: '雨' },
            55: { icon: '🌧️', text: '大雨' },
            61: { icon: '🌧️', text: '雨' },
            63: { icon: '🌧️', text: '強い雨' },
            65: { icon: '🌧️', text: '激しい雨' },
            71: { icon: '❄️', text: '小雪' },
            73: { icon: '❄️', text: '雪' },
            75: { icon: '❄️', text: '大雪' },
            95: { icon: '⛈️', text: '雷雨' }
        };
        return descMap[code] || { icon: '❓', text: '不明' };
    }
}
