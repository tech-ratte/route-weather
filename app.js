// 各レイヤーの初期化
const routingProvider = new OsrmRoutingProvider(); 
const fileRoutingProvider = new FileRoutingProvider();
const urlRoutingProvider = new UrlRoutingProvider(fileRoutingProvider, routingProvider);
const weatherService = new WeatherService();
let mapManager;

// DOM要素
const form = document.getElementById('route-form');
const startInput = document.getElementById('start-input');
const endInput = document.getElementById('end-input');
const currentLocBtn = document.getElementById('current-loc-btn');

let currentGeoPos = null;

const viaPointsContainer = document.getElementById('via-points-container');
const addViaBtn = document.getElementById('add-via-btn');

const dateSelect = document.getElementById('date-select');
const timeSelect = document.getElementById('time-select');
const modeSelect = document.getElementById('mode-select');

const uploadForm = document.getElementById('upload-form');
const urlInput = document.getElementById('url-input');
const fileInput = document.getElementById('file-input');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// 読み込み状態とメッセージ等
const searchBtn = document.getElementById('search-btn');
const uploadBtn = document.getElementById('upload-btn');
const spinnerContainer = document.getElementById('loading-spinner-container');
const errorBox = document.getElementById('error-message');
const routeInfoBox = document.getElementById('route-info');
const distanceText = document.getElementById('distance-text');
const durationText = document.getElementById('duration-text');
const weatherListObj = document.getElementById('weather-list');

// Resize Sidebar Logic
const controlsPanel = document.getElementById('controls');
const controlsScrollArea = document.getElementById('controls-scroll-area');
const resizeHandle = document.getElementById('resize-handle');
const mobileResizeHandle = document.getElementById('mobile-resize-handle');
let isResizing = false;
let isMobileResizing = false;

function init() {
    // 地図の初期化
    mapManager = new MapManager('map');

    // サイドバーのリサイズ (PC - 横幅)
    let startX, startWidth;
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = controlsPanel.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        resizeHandle.classList.add('resizing');
        // リサイズ中は遷移（アニメーション）を無効化
        controlsPanel.style.transition = 'none';
        e.preventDefault();
    });

    // サイドバーのリサイズ (Mobile - 高さ)
    const startMobileResize = (e) => {
        isMobileResizing = true;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    };

    mobileResizeHandle.addEventListener('mousedown', startMobileResize);
    mobileResizeHandle.addEventListener('touchstart', (e) => {
        startMobileResize(e);
        // touchstart では preventDefault しない方がスクロール等に良い場合もあるが、
        // 今回はリサイズハンドルなので固定したい
    }, { passive: false });

    const onMove = (e) => {
        if (isResizing) {
            const clientX = e.clientX || (e.touches ? e.touches[0].clientX : null);
            if (clientX === null) return;
            const newWidth = startWidth + (clientX - startX);
            if (newWidth > 300 && newWidth < 800) {
                controlsPanel.style.width = `${newWidth}px`;
            }
        } else if (isMobileResizing) {
            const clientY = e.clientY || (e.touches ? e.touches[0].clientY : null);
            if (clientY === null) return;

            // 上端からの高さ (mobileResizeHandle が下端にあるため)
            const newHeight = clientY;
            const minHeight = window.innerHeight * 0.15;
            const maxHeight = window.innerHeight * 0.85;

            if (newHeight > minHeight && newHeight < maxHeight) {
                controlsPanel.style.height = `${newHeight}px`;
            }
        }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });

    const onUp = () => {
        if (isResizing || isMobileResizing) {
            isResizing = false;
            isMobileResizing = false;
            document.body.style.cursor = 'default';
            resizeHandle.classList.remove('resizing');
            // 遷移（アニメーション）を元に戻す
            controlsPanel.style.transition = '';
        }
    };

    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    // 日時プルダウンの初期化
    populateDateTimeSelects();

    // タブ切り替えイベント
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // 経由地追加イベント
    addViaBtn.addEventListener('click', () => {
        const div = document.createElement('div');
        div.className = 'via-point-group';
        div.innerHTML = `
            <input type="text" class="via-input" placeholder="例: 静岡駅" required>
            <button type="button" class="remove-via-btn">🗑️</button>
        `;
        div.querySelector('.remove-via-btn').addEventListener('click', () => {
            div.remove();
        });
        viaPointsContainer.appendChild(div);
    });

    // 検索フォーム送信イベント
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const startValue = startInput.value.trim();
        const endObj = endInput.value.trim();
        if (!startValue || !endObj) return;

        // "現在地" の判定と座標変換
        let startObj = startValue;
        if (startValue === "現在地" && currentGeoPos) {
            startObj = `${currentGeoPos.lat}, ${currentGeoPos.lng}`;
        }

        // 経由地の取得
        const viaInputs = Array.from(viaPointsContainer.querySelectorAll('.via-input'));
        const waypoints = [startObj];
        viaInputs.forEach(input => {
            if (input.value.trim()) waypoints.push(input.value.trim());
        });
        waypoints.push(endObj);

        // 日時取得
        let targetDate = getSelectedDate();

        setLoading(true, searchBtn);
        try {
            const transportMode = modeSelect.value;
            // OSRMのプロファイル名に変換 (driving -> car, cycling -> bicycle, walking -> foot)
            const osrmMode = transportMode === 'driving' ? 'car' : 
                             transportMode === 'cycling' ? 'bicycle' : 'foot';
            
            routingProvider.setMode(osrmMode);
            const routeData = await routingProvider.getRoute(waypoints);
            
            await processRouteAndWeather(routeData, targetDate);
        } catch (err) {
            console.error(err);
            showError(err.message || "予期せぬエラーが発生しました");
        } finally {
            setLoading(false, searchBtn);
        }
    });

    // ファイルアップロード / URL送信イベント
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const urlValue = urlInput.value.trim();
        const file = fileInput.files[0];
        
        if (!urlValue && !file) {
            showError("URLまたはファイルを入力してください");
            return;
        }

        let targetDate = getSelectedDate();

        setLoading(true, uploadBtn);
        try {
            const transportMode = modeSelect.value;
            const osrmMode = transportMode === 'driving' ? 'car' : 
                             transportMode === 'cycling' ? 'bicycle' : 'foot';
            
            routingProvider.setMode(osrmMode);
            fileRoutingProvider.setMode(osrmMode); // To calculate duration for files

            let routeData;
            if (urlValue) {
                // URLからの取得を優先
                routeData = await urlRoutingProvider.getRouteFromUrl(urlValue);
                urlInput.value = '';
            } else {
                // ファイルからの読み込み
                routeData = await fileRoutingProvider.getRouteFromFile(file);
                fileInput.value = '';
            }
            await processRouteAndWeather(routeData, targetDate);
        } catch (err) {
            console.error(err);
            showError(err.message || "データの読み取りに失敗しました");
        } finally {
            setLoading(false, uploadBtn);
        }
    });

    // ※ マップ全体へのクリックリスナーは削除し、経路（routeLayer）へのクリックのみに限定します
    // (路線のクリックイベントは processRouteAndWeather 内で動的に付与します)

    // 現在地ボタンのクリックイベント
    if (currentLocBtn && navigator.geolocation) {
        currentLocBtn.addEventListener('click', () => {
            currentLocBtn.innerText = "⏳";
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    currentGeoPos = {
                        lat: pos.coords.latitude.toFixed(6),
                        lng: pos.coords.longitude.toFixed(6)
                    };
                    startInput.value = "現在地";
                    currentLocBtn.innerText = "📍";
                },
                (err) => {
                    console.error(err);
                    showError("現在地の取得に失敗しました。以前の許可をリセットするか、手動で入力してください。");
                    currentLocBtn.innerText = "📍";
                }
            );
        });
    }

    // 入力欄が手動で変更されたら現在地フラグをリセット
    startInput.addEventListener('input', () => {
        if (startInput.value !== "現在地") {
            currentGeoPos = null;
        }
    });
}

function getSelectedDate() {
    const dStr = dateSelect.value;
    if (dStr === 'now') return null;
    
    // yyyy-mm-dd
    const target = new Date(`${dStr}T00:00:00`);
    target.setHours(parseInt(timeSelect.value, 10));
    return target;
}

function populateDateTimeSelects() {
    const now = new Date();
    
    // 今すぐ(デフォルト)
    dateSelect.add(new Option('今すぐ', 'now'));
    
    for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateString = `${yyyy}-${mm}-${dd}`;
        
        let label = `${mm}/${dd}`;
        if (i === 0) label += " (今日)";
        if (i === 1) label += " (明日)";
        
        dateSelect.add(new Option(label, dateString));
    }

    for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, '0');
        timeSelect.add(new Option(`${hh}:00`, h));
    }
    
    // 初期値を現在の時間に近くする
    timeSelect.value = now.getHours();
}

function setLoading(isLoading, btnTarget) {
    btnTarget.disabled = isLoading;
    if (isLoading) {
        spinnerContainer.classList.remove('hidden');
        errorBox.classList.add('hidden');
    } else {
        spinnerContainer.classList.add('hidden');
    }
}

function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
}

function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}時間 ${mins}分`;
    return `${mins}分`;
}

// 現在のルートデータと天気データの保持
let currentRouteData = null;
let currentWeatherDataList = [];
let currentTargetDate = null;

// 共通処理: ルートを描画し、天気を取得して表示する
async function processRouteAndWeather(routeData, targetDate) {
    currentRouteData = routeData;
    currentTargetDate = targetDate;
    
    mapManager.clear();
    weatherListObj.innerHTML = '';
    
    // 経路上に線を引く
    const isMobile = window.innerWidth <= 768;
    const panelH = controlsPanel.offsetHeight;
    const fitOptions = isMobile 
        ? { paddingTopLeft: [0, panelH + 20], paddingBottomRight: [20, 20] } 
        : { padding: [50, 50] };
        
    mapManager.drawRoute(routeData.routeCoordinates, fitOptions);
    
    // 追加: 道路（ポリライン）自体のクリックイベント
    if (mapManager.routeLayer) {
        mapManager.routeLayer.on('click', async (e) => {
            // イベントの伝播を止める
            L.DomEvent.stopPropagation(e);
            const latlng = e.latlng;
            await addCustomWeatherPoint([latlng.lat, latlng.lng]);
        });
    }
    
    // サマリーを表示
    distanceText.textContent = `距離: ${formatDistance(routeData.distance)}`;
    durationText.textContent = `所要時間: ${formatDuration(routeData.duration)}`;
    routeInfoBox.style.display = 'block';
    
    // 計算完了後、経路サマリーが理想的な位置（一番上）にくるようにスクロール
    setTimeout(() => {
        if (routeInfoBox) {
            routeInfoBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 200);

    // 経路上の天気情報を取得 (5地点)
    currentWeatherDataList = await weatherService.getWeatherAlongRoute(
        routeData.routeCoordinates, 
        5, 
        targetDate, 
        routeData.duration
    );

    // IDを付与 (削除用)
    currentWeatherDataList.forEach((d, i) => d.id = `point-${Date.now()}-${i}`);
    
    // マップ上に天気をプロット
    mapManager.drawWeatherMarkers(currentWeatherDataList, weatherService);
    
    // 左パネルに天気リストを描画
    renderWeatherList(currentWeatherDataList);
}

// クリックで任意の地点に天気を追加する
async function addCustomWeatherPoint(latlng) {
    if (!currentRouteData) return;
    
    // クリック地点が経路全体のうち何割の進捗位置にあるか簡易的に算出(直線距離による近似)
    const totalDist = currentRouteData.distance;
    let nearestDist = Infinity;
    let fraction = 0.5; // fallback
    let lengthSoFar = 0;
    const R = 6371e3;

    // ポリライン上の距離を計算して直近の点を探す
    for (let i = 0; i < currentRouteData.routeCoordinates.length - 1; i++) {
        const p1 = currentRouteData.routeCoordinates[i];
        const p2 = currentRouteData.routeCoordinates[i+1];
        
        // p1からp2の長さを加算
        const a1 = (Math.sin((p2[0]-p1[0])*Math.PI/180/2))**2 + Math.cos(p1[0]*Math.PI/180) * Math.cos(p2[0]*Math.PI/180) * (Math.sin((p2[1]-p1[1])*Math.PI/180/2))**2;
        const distP1P2 = R * (2 * Math.atan2(Math.sqrt(a1), Math.sqrt(1-a1)));
        lengthSoFar += distP1P2;

        // p1とクリック点の距離
        const a2 = (Math.sin((latlng[0]-p1[0])*Math.PI/180/2))**2 + Math.cos(p1[0]*Math.PI/180) * Math.cos(latlng[0]*Math.PI/180) * (Math.sin((latlng[1]-p1[1])*Math.PI/180/2))**2;
        const d = R * (2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2)));

        if (d < nearestDist) {
            nearestDist = d;
            fraction = lengthSoFar / totalDist;
        }
    }
    
    const baseTimeMs = currentTargetDate ? currentTargetDate.getTime() : Date.now();
    const timeOffsetMs = fraction * currentRouteData.duration * 1000;
    const pointTime = new Date(baseTimeMs + timeOffsetMs);

    // 天気取得
    const data = await weatherService.getSinglePointWeather(latlng, pointTime, "カスタムポイント");
    data.id = `custom-${Date.now()}`;
    
    // リストの後ろ（または進捗順にソートして）追加
    currentWeatherDataList.push(data);
    
    // 進捗（時間）順に並び替え
    currentWeatherDataList.sort((a,b) => new Date(a.expectedTime||a.time).getTime() - new Date(b.expectedTime||b.time).getTime());

    // 再描画
    mapManager.drawWeatherMarkers(currentWeatherDataList, weatherService);
    renderWeatherList(currentWeatherDataList);
}

function renderWeatherList(weatherDataList) {
    weatherListObj.innerHTML = '';
    
    weatherDataList.forEach((data, index) => {
        const wInfo = weatherService.getWeatherIcon(data.weathercode);
        
        let dateStr = "";
        const targetT = data.expectedTime ? new Date(data.expectedTime) : (data.time ? new Date(data.time) : null);
        if (targetT) {
            const mm = String(targetT.getMonth()+1).padStart(2,'0');
            const dd = String(targetT.getDate()).padStart(2,'0');
            const hh = String(targetT.getHours()).padStart(2,'0');
            const min = String(targetT.getMinutes()).padStart(2,'0');
            dateStr = ` / 通過予想 ${mm}/${dd} ${hh}:${min}`;
        }

        const card = document.createElement('div');
        card.className = 'weather-card';
        card.innerHTML = `
            <div class="weather-icon">${wInfo.icon}</div>
            <div class="weather-details">
                <div class="weather-time">${data.label}</div>
                <div class="weather-desc">${wInfo.text}${dateStr}</div>
            </div>
            <div class="weather-temp">${data.temperature}°C</div>
            <button class="weather-delete-btn" title="削除">🗑️</button>
        `;
        
        // 削除ボタンのイベント
        card.querySelector('.weather-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // カード自体のクリックイベント（zoomなど）を防ぐ
            currentWeatherDataList = currentWeatherDataList.filter(item => item.id !== data.id);
            mapManager.drawWeatherMarkers(currentWeatherDataList, weatherService);
            renderWeatherList(currentWeatherDataList);
        });

        // カードクリックで地図移動
        card.addEventListener('click', () => {
            const viewportH = window.innerHeight;
            const panelH = controlsPanel.offsetHeight;
            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                // パネルが上にある場合、パネル下端から画面下端までが可視領域
                const visibleH = viewportH - panelH;
                const visibleCenterY = panelH + (visibleH / 2);
                const screenCenterY = viewportH / 2;
                // screenCenterY (500) から visibleCenterY (700) へ移動させたい
                // つまりマップの中心を上に offsetPx 分ずらす
                const pixelOffset = visibleCenterY - screenCenterY;
                
                mapManager.flyToWithOffset(data.location, 11, pixelOffset);
            } else {
                mapManager.map.flyTo(data.location, 11, { duration: 0.5 });
            }
            
            const marker = mapManager.weatherMarkers[index];
            if (marker) marker.openPopup();
        });
        
        weatherListObj.appendChild(card);
    });
}

// アプリの起動
document.addEventListener('DOMContentLoaded', init);
