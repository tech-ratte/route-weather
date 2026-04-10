/**
 * URL (Google Maps 共有URL等) から経路情報を取得・抽出・推測するプロバイダ
 */
class UrlRoutingProvider extends RoutingProvider {
    
    constructor(fileRoutingProvider, osrmRoutingProvider) {
        super();
        this.fileRoutingProvider = fileRoutingProvider;
        this.osrmRoutingProvider = osrmRoutingProvider;
    }

    /**
     * URL文字列から経路を取得する
     */
    async getRouteFromUrl(urlStr) {
        if (!urlStr || !urlStr.startsWith('http')) {
            throw new Error("有効なURLを入力してください");
        }

        try {
            // 1. My Maps の URL (mid= が含まれている) の場合
            if (urlStr.includes('google.com/maps/d/')) {
                return await this._handleMyMapsUrl(urlStr);
            }

            // 2. 短縮URL (maps.app.goo.gl または goo.gl) の場合
            if (urlStr.includes('maps.app.goo.gl') || urlStr.includes('goo.gl/maps/')) {
                return await this._handleShortUrl(urlStr);
            }

            // 3. 通常の経路検索URL (google.com/maps/dir/...)
            if (urlStr.includes('/maps/dir/')) {
                return await this._handleDirUrl(urlStr);
            }

            throw new Error("対応していないGoogle MapsのURL形式です。");
        } catch (err) {
            console.error("URL Provider Error:", err);
            throw new Error(`URL解析エラー: ${err.message}`);
        }
    }

    async _handleMyMapsUrl(urlStr) {
        // mid を抽出
        const urlObj = new URL(urlStr);
        const mid = urlObj.searchParams.get('mid');
        if (!mid) throw new Error("My Maps のID (mid) が見つかりません。");

        // KMLのダウンロードURLを構築
        const kmlUrl = `https://www.google.com/maps/d/kml?mid=${mid}`;

        // CORSを回避するため、AllOriginsの公開プロキシ等を利用して取得
        // ※デモ・ローカル実行用の回避策であり、本番環境では自前プロキシ推奨
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(kmlUrl)}`;
        
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("KMLの取得に失敗しました。");
        
        const data = await res.json();
        const kmlText = data.contents;

        if (!kmlText || !kmlText.includes('<?xml')) {
            throw new Error("有効なKMLデータが取得できませんでした。マップが公開設定になっているか確認してください。");
        }

        // FileRoutingProvider の _parseKML を再利用してパース
        const routeCoords = this.fileRoutingProvider._parseKML(kmlText);

        if (routeCoords.length < 2) {
            throw new Error("KML内に経路データが見つかりませんでした");
        }
        
        const distance = this.fileRoutingProvider._calculateDistance(routeCoords);
        const duration = distance / 11.1; 

        return {
            routeCoordinates: routeCoords,
            distance: distance,
            duration: duration,
            waypoints: [
                { name: "My Maps 起点", location: routeCoords[0] },
                { name: "My Maps 終点", location: routeCoords[routeCoords.length - 1] }
            ]
        };
    }

    async _handleShortUrl(urlStr) {
        // 短縮URLはリダイレクト先を展開する必要がある。AllOriginsはリダイレクトを追跡する仕様を利用。
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(urlStr)}`;
        let res;
        try {
            res = await fetch(proxyUrl);
            if (!res.ok) throw new Error();
        } catch (e) {
            throw new Error("短縮URLの展開がブロックされました。一度ブラウザでURLを開き、上部のアドレスバーにある長いURL（google.com/maps/dir/...）をコピーしてペーストしてください。");
        }
        
        const data = await res.json();
        // data.status.url にリダイレクト先（本当のURL）が入る
        const finalUrl = data.status && data.status.url ? data.status.url : urlStr;

        if (finalUrl.includes('/maps/dir/')) {
            return await this._handleDirUrl(finalUrl);
        } else if (finalUrl.includes('/maps/d/')) {
            return await this._handleMyMapsUrl(finalUrl);
        } else {
            throw new Error("短縮URLの展開がブロックされました。一度ブラウザでURLを開き、上部のアドレスバーにある長いURL（google.com/maps/dir/...）をコピーしてペーストしてください。");
        }
    }

    async _handleDirUrl(urlStr) {
        // 例: https://www.google.com/maps/dir/Tokyo/Osaka/...
        const urlObj = new URL(urlStr);
        const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
        const dirIndex = pathSegments.indexOf('dir');
        
        if (dirIndex === -1 || pathSegments.length <= dirIndex + 2) {
            throw new Error("経路URLから出発地と目的地を抽出できませんでした。");
        }

        let coords = [];

        // 1. URLパスの中から直接座標らしきものを探す (Originなどが座標の場合)
        for (let i = dirIndex + 1; i < pathSegments.length; i++) {
            const seg = decodeURIComponent(pathSegments[i]);
            // Exclude segments starting with @ (viewport bounds)
            if (seg.startsWith('@')) continue;
            
            const match = seg.match(/^([+-]?\d+\.\d+),\s*([+-]?\d+\.\d+)$/);
            if (match) {
                coords.push([parseFloat(match[1]), parseFloat(match[2])]); // [lat, lng]
            }
        }

        // 2. data=パラメータ内の !1d(Lng)!2d(Lat) から残りの座標を抽出
        const coordRegex = /!1d([+-]?\d+\.\d+)!2d([+-]?\d+\.\d+)/g;
        let match;
        while ((match = coordRegex.exec(urlStr)) !== null) {
            const lng = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            if (!isNaN(lat) && !isNaN(lng)) {
                coords.push([lat, lng]);
            }
        }

        // 順番を整理 (GoogleMapsではDestinationが後に現れることが多い)
        // 少なくとも始点と終点があれば座標ルーティングを使う
        if (coords.length >= 2) {
            const startLoc = coords[0];
            const endLoc = coords[coords.length - 1];
            return await this.osrmRoutingProvider.getRouteFromCoords([startLoc, endLoc], ["出発地 (抽出)", "目的地 (抽出)"]);
        }

        // --- フォールバック: 座標が見つからない場合は地名文字列をきれいにして検索 ---
        const rawStart = decodeURIComponent(pathSegments[dirIndex + 1]);
        const rawEnd = decodeURIComponent(pathSegments[dirIndex + 2]);
        
        const startNameClean = this._cleanAddress(rawStart);
        const endNameClean = this._cleanAddress(rawEnd);

        console.log(`URL Parsing Fallback: Extracted [${startNameClean}] -> [${endNameClean}]`);
        return await this.osrmRoutingProvider.getRoute([startNameClean, endNameClean]);
    }

    _cleanAddress(str) {
        if (!str) return "";
        let s = str.replace(/\+/g, ' '); // ＋をスペースに
        s = s.replace(/〒\d{3}-\d{4}/g, ''); // 郵便番号を削除(Nominatimエラーの原因)
        // 「、」以降に住所詳細が続くことが多いので、最も特徴的な最初の部分だけにするか、
        // 曖昧な検索を避けるためにそのまま渡すか。Nominatimは長文住所で失敗しやすい。
        const parts = s.split(/[、,]/);
        return parts[0].trim();
    }
}
