// js/renderer.js - Three.js 3D 渲染與互動

class ChessRenderer {
    constructor() {
        this.container = document.getElementById('game-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        this.boardMesh = null;
        this.pieceMeshes = {}; // 'row,col' => mesh
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.onPieceClick = null; // 回呼函數

        /* 🎨 配色來源(2026-09-09,**已更正**):使用者指定「3chinese.netlify.app 的綠底棋子與
             米白底棋盤做得很漂亮,請參考」。
           ★★ 我一開始判錯,記下來免得下一手再錯:我看它的工具列(難度/開局譜/2D/存檔讀檔/安裝/
              重置視角)和本站幾乎一樣,就推論「它是本站 v1 之前那個沒有原始碼的前身」——**錯的**。
              使用者反問「為何之後要改配色?我認為不是前身」,查下去才對:
              它是**第三個**中國象棋站 `3d-chinese-chess`(React + Vite,**有完整原始碼**),
              還活著,線上三個網址:3dchinese / 3d-chinese-chess / 3dchinesechess .pages.dev。
              `3chinese.netlify.app` 只是它搬到 CF Pages 之前的舊 Netlify 網址(現在 404)。
              ⇒ 所以配色**不必**靠截圖目測,直接抄它的原始碼精確值(下面這幾個就是):
                `src/components/Piece.jsx`(棋子面/綠邊/紅字/黑字)、`src/components/Board.jsx`
                (盤面 #ebc38a、格線 #594433)、`src/App.jsx`(背景 #2c3e50)。
              第一版我目測的值(bg 0x2f4050 / boardTop 0xece0c0 / gridLine 0x5b3a1a /
              pieceSide 0x3fa84c / face #f8f5ee / red #d81f26 / black #1b2a5e)都很接近但不精確,
              已全部換成上面那份原始碼的值。boardSide 是唯一「推」出來的:參考站的盤是平面、沒有側面色。
           ★ 參考站的「選中/被提示的棋子」是**橘色** `#f4a261` 頂面 + 深綠 `#2e7d32` 邊。
             本站不抄那一套:本站的提示是綠圈 + 綠點(不動棋子本身的顏色),兩者不要混。
           改之前(整片偏黃褐、和背景糊在一起):棋盤 0xd2b48c、格線 0x000000、
             棋子頂 #f0d9b5 + 棕圈、棋子側 0xe0c090、紅字 #ff0000、黑字 #000000、背景 0x333333。 */
        this.PALETTE = {
            bg: 0x2c3e50,          // 背景:深板岩藍(App.jsx 的 <color background>)
            /* 盤面/盤側 ⚠ **刻意不用參考站的十六進位值**(它是 0xebc38a)。
               同一個色碼在不同的材質與燈光下**不是同一個顏色**:參考站是 R3F 的
               meshStandardMaterial + roughness 0.8,本站是 MeshPhongMaterial + 環境光 0.6
               + 平行光 0.8 ⇒ 照抄 0xebc38a 渲出來明顯偏黃(實機截圖比對過),
               反而比目測值離參考站的觀感**更遠**。⇒ 這兩個值以「看起來像不像截圖」為準,不是以色碼為準。 */
            boardTop: 0xece0c0,    // 盤面:米白(對齊截圖觀感,不是對齊色碼)
            boardSide: 0xdcc9a0,   // 盤側(厚度)比盤面深一階(參考站是平面盤,沒有側面色)
            gridLine: 0x594433,    // 格線:深咖啡(Board.jsx lineColor)—— 不是黑
            pieceSide: 0x4caf50,   // ★ 棋子綠邊 = 使用者說的「綠底棋子」(Piece.jsx 下半圓柱)
            pieceFace: '#fdfaf6',  // 棋子頂面:象牙白(Piece.jsx 上半圓柱)
            pieceRing: '#cfc7b5',  // 頂面那兩圈:柔和的灰 ★ 本站自有,參考站的字是 3D Text、沒有圈
            redInk: '#e63946',     // 紅方的字(Piece.jsx)
            blackInk: '#1d3557',   // 黑方的字:深藍(Piece.jsx)—— 不是黑
        };

        // 常數設定
        this.SQUARE_SIZE_X = 10;
        this.SQUARE_SIZE_Y = 8.5; // 讓棋盤長度(Y軸)短一點，符合視覺比例
        this.BOARD_WIDTH = 9 * this.SQUARE_SIZE_X;
        this.BOARD_HEIGHT = 10 * this.SQUARE_SIZE_Y;
        this.BOARD_THICKNESS = 4;
        this.PIECE_RADIUS = 4;
        this.PIECE_HEIGHT = 2;
        
        this.highlightMeshes = [];
        this.animationId = null;

        /* 對局場新增:2D/3D 視角與 2D 旋轉(舊版無源碼那支的招牌功能之一)。
           spin 只在 2D 生效 —— 3D 已經可以用滑鼠自由轉,再給兩顆旋轉鈕只會打架。 */
        this.viewMode = '3d';
        this.boardSpin = 0;    // 度
        
        // 動畫相關狀態
        this.animatingPieces = []; // { mesh, targetPos, startTime, duration }
        
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
        /* ⛶ 容器尺寸一變就重量(全螢幕進出、側欄收合、轉向)——
           window 的 resize 只在視窗變時才響;元素全螢幕時容器變了、視窗未必變。 */
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
            this.resizeObserver.observe(this.container);
        }
        // 支援滑鼠與觸控點擊
        this.container.addEventListener('pointerdown', this.onMouseClick.bind(this), false);
    }
    
    initScene(initialBoardState) {
        // 1. Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.PALETTE.bg);
        
        /* 2. Camera
           ⚠⚠ 尺寸一律看**容器**,不是 window ——
             舊版線上那支就是拿 window.innerWidth/innerHeight 當畫布尺寸,而畫布其實住在
             右邊有資訊欄的版面裡 ⇒ 相機的長寬比和真正的畫布對不起來,棋盤被撐爆:
             實機截圖看得到紅方底線(帥/仕/相/俥/傌)整排被切在畫面外,根本點不到。
             這是重建時**一定要修掉**的既有缺陷,不是照抄。 */
        const size = this.containerSize();
        this.camera = new THREE.PerspectiveCamera(45, size.w / size.h, 0.1, 1000);

        // 3. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(size.w, size.h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.shadowMap.enabled = true;
        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);
        
        // 4. Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        /* 🖐 觸控裝置把靈敏度降下來(2026-09-09 使用者實機退件:
             「手機版棋盤旋轉與移動太靈敏、太快了」)。
           OrbitControls 的旋轉量 = 2π × 拖曳像素 ÷ **容器高** × rotateSpeed(兩軸都除容器高,
           見 OrbitControls 的 `// yes, height`)⇒ 速度 1.0 時,直向手機 390×844 上
           一根手指劃 150px 就轉 **64°**,手指一滑棋盤就飛走。
           ⇒ 觸控 0.4(同樣 150px ≈ 26°)、平移 0.5。
           ★ 滑鼠不動(維持 1.0):桌機是「按著拖曳看」而不是「滑過去」,而且有滑鼠的精度;
             把桌機一起調慢會變成要拖很多下才轉得動。
           ★ 這個病**不是** 0908 的全螢幕造成的:全螢幕之後容器**變高**(668 → 844),
             而旋轉量是除以容器高 ⇒ 每像素其實比以前**不敏感**。
             是預設值 1.0 從 0902 建站就一直太快,使用者現在真的在手機上玩全螢幕了才踩到。 */
        const coarsePointer = typeof window.matchMedia === 'function'
            && window.matchMedia('(pointer: coarse)').matches;
        this.controls.rotateSpeed = coarsePointer ? 0.4 : 1.0;
        this.controls.panSpeed = coarsePointer ? 0.5 : 1.0;
        // 允許玩家水平 360 度任意旋轉觀看棋盤
        this.controls.minAzimuthAngle = -Infinity;
        this.controls.maxAzimuthAngle = Infinity;
        // 放寬垂直視角限制，讓玩家可以從正上方甚至稍微從底部觀看
        this.controls.maxPolarAngle = Math.PI; // 允許轉到棋盤正下方
        this.controls.minPolarAngle = 0; // 允許轉到正上方純 2D 視角
        
        // 5. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(50, 50, 100);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
        
        // 6. Build Board
        this.createBoard();
        
        // 7. Place Pieces
        this.updateBoardState(initialBoardState);

        /* 最後才裝相機:controls 要先存在(fitCamera 會去設它的 target 與 enableRotate)。
           順序反過來的話 fitCamera 裡那段 if (this.controls) 會靜靜跳過,
           結果 2D 模式下滑鼠還是轉得動、而且沒有任何錯誤訊息。 */
        this.fitCamera();
    }
    
    createBoard() {
        // 棋盤本體 (木頭顏色)
        const boardGeo = new THREE.BoxGeometry(this.BOARD_WIDTH, this.BOARD_HEIGHT, this.BOARD_THICKNESS);
        /* BoxGeometry 的材質順序 [+X,-X,+Y,-Y,+Z,-Z];這塊板的厚度在 Z ⇒ index 4 是棋盤面 */
        const sideMat = new THREE.MeshPhongMaterial({ color: this.PALETTE.boardSide });
        const boardMat = [
            sideMat, sideMat, sideMat, sideMat,
            new THREE.MeshPhongMaterial({ color: this.PALETTE.boardTop }),   // +Z = 棋盤面
            sideMat,
        ];
        this.boardMesh = new THREE.Mesh(boardGeo, boardMat);
        this.boardMesh.receiveShadow = true;
        // 把棋盤表面放在 z=0 平面
        this.boardMesh.position.z = -this.BOARD_THICKNESS / 2;
        this.scene.add(this.boardMesh);
        
        // 繪製棋盤線條 (簡單的線段)
        const lineMaterial = new THREE.LineBasicMaterial({ color: this.PALETTE.gridLine });
        const startX = -this.BOARD_WIDTH / 2 + this.SQUARE_SIZE_X / 2;
        const startY = -this.BOARD_HEIGHT / 2 + this.SQUARE_SIZE_Y / 2;
        
        // 橫線
        for (let i = 0; i < 10; i++) {
            const points = [];
            points.push(new THREE.Vector3(startX, startY + i * this.SQUARE_SIZE_Y, 0.1));
            points.push(new THREE.Vector3(startX + 8 * this.SQUARE_SIZE_X, startY + i * this.SQUARE_SIZE_Y, 0.1));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, lineMaterial);
            this.scene.add(line);
        }
        
        // 直線
        for (let j = 0; j < 9; j++) {
            const x = startX + j * this.SQUARE_SIZE_X;
            // 上半部
            const pointsTop = [];
            pointsTop.push(new THREE.Vector3(x, startY + 5 * this.SQUARE_SIZE_Y, 0.1));
            pointsTop.push(new THREE.Vector3(x, startY + 9 * this.SQUARE_SIZE_Y, 0.1));
            const geoTop = new THREE.BufferGeometry().setFromPoints(pointsTop);
            this.scene.add(new THREE.Line(geoTop, lineMaterial));
            
            // 下半部
            const pointsBot = [];
            pointsBot.push(new THREE.Vector3(x, startY, 0.1));
            pointsBot.push(new THREE.Vector3(x, startY + 4 * this.SQUARE_SIZE_Y, 0.1));
            const geoBot = new THREE.BufferGeometry().setFromPoints(pointsBot);
            this.scene.add(new THREE.Line(geoBot, lineMaterial));
        }
        // 楚河漢界邊緣線
        const pointsMidL = [];
        pointsMidL.push(new THREE.Vector3(startX, startY + 4 * this.SQUARE_SIZE_Y, 0.1));
        pointsMidL.push(new THREE.Vector3(startX, startY + 5 * this.SQUARE_SIZE_Y, 0.1));
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsMidL), lineMaterial));

        const pointsMidR = [];
        pointsMidR.push(new THREE.Vector3(startX + 8 * this.SQUARE_SIZE_X, startY + 4 * this.SQUARE_SIZE_Y, 0.1));
        pointsMidR.push(new THREE.Vector3(startX + 8 * this.SQUARE_SIZE_X, startY + 5 * this.SQUARE_SIZE_Y, 0.1));
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsMidR), lineMaterial));


        // 九宮格斜線 (紅方)
        const p1 = new THREE.Vector3(startX + 3 * this.SQUARE_SIZE_X, startY, 0.1);
        const p2 = new THREE.Vector3(startX + 5 * this.SQUARE_SIZE_X, startY + 2 * this.SQUARE_SIZE_Y, 0.1);
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), lineMaterial));
        const p3 = new THREE.Vector3(startX + 5 * this.SQUARE_SIZE_X, startY, 0.1);
        const p4 = new THREE.Vector3(startX + 3 * this.SQUARE_SIZE_X, startY + 2 * this.SQUARE_SIZE_Y, 0.1);
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p3, p4]), lineMaterial));
        
        // 九宮格斜線 (黑方)
        const p5 = new THREE.Vector3(startX + 3 * this.SQUARE_SIZE_X, startY + 9 * this.SQUARE_SIZE_Y, 0.1);
        const p6 = new THREE.Vector3(startX + 5 * this.SQUARE_SIZE_X, startY + 7 * this.SQUARE_SIZE_Y, 0.1);
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p5, p6]), lineMaterial));
        const p7 = new THREE.Vector3(startX + 5 * this.SQUARE_SIZE_X, startY + 9 * this.SQUARE_SIZE_Y, 0.1);
        const p8 = new THREE.Vector3(startX + 3 * this.SQUARE_SIZE_X, startY + 7 * this.SQUARE_SIZE_Y, 0.1);
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p7, p8]), lineMaterial));
        
        // 添加隱形的點擊面，讓玩家可以點擊空格子
        const clickPlaneGeo = new THREE.PlaneGeometry(this.BOARD_WIDTH, this.BOARD_HEIGHT);
        const clickPlaneMat = new THREE.MeshBasicMaterial({ visible: false });
        const clickPlane = new THREE.Mesh(clickPlaneGeo, clickPlaneMat);
        clickPlane.name = "ClickPlane";
        clickPlane.position.z = 0.2; // 稍微高於棋盤線條
        this.scene.add(clickPlane);
    }
    
    // 將棋盤陣列索引 (row, col) 轉換為 3D 座標 (x, y)
    getGridPosition(row, col) {
        const startX = -this.BOARD_WIDTH / 2 + this.SQUARE_SIZE_X / 2;
        // row 0 在下面 (紅方)，row 9 在上面 (黑方)
        const startY = -this.BOARD_HEIGHT / 2 + this.SQUARE_SIZE_Y / 2;
        return {
            x: startX + col * this.SQUARE_SIZE_X,
            y: startY + row * this.SQUARE_SIZE_Y
        };
    }
    
    // 將 3D 座標轉換為棋盤陣列索引
    getGridIndex(x, y) {
        const startX = -this.BOARD_WIDTH / 2 + this.SQUARE_SIZE_X / 2;
        const startY = -this.BOARD_HEIGHT / 2 + this.SQUARE_SIZE_Y / 2;
        
        let col = Math.round((x - startX) / this.SQUARE_SIZE_X);
        let row = Math.round((y - startY) / this.SQUARE_SIZE_Y);
        
        if (row >= 0 && row < 10 && col >= 0 && col < 9) {
            return { row, col };
        }
        return null;
    }

    createPieceTexture(name, isRed) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // 背景
        ctx.fillStyle = this.PALETTE.pieceFace;
        ctx.beginPath();
        ctx.arc(64, 64, 60, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.PALETTE.pieceRing;
        ctx.lineWidth = 4;
        ctx.stroke();

        // 內圈
        ctx.beginPath();
        ctx.arc(64, 64, 48, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // 文字
        ctx.fillStyle = isRed ? this.PALETTE.redInk : this.PALETTE.blackInk;
        ctx.font = 'bold 60px "楷体", "KaiTi", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        /* ⚠⚠ 圓柱頂面的 UV 配上 geometry.rotateX(π/2) 之後,字是**轉了 90°** 的。
           修法就一行:把貼圖轉回來(不要去改畫字那段 —— 改畫字的話,
           將來換成圖片素材又會歪)。

           ★★ 這個角度是**排出來看**的,不是推出來的:
             我先憑推理猜「左右鏡像」(repeat.x=-1)⇒ 錯;再猜「上下顛倒」(flipY=false)⇒ 也錯。
             最後把「鏡像 × 旋轉 0/90/180/270」八種組合並排渲染成一張圖(screenshots/uv-8.png),
             一眼就挑出唯一正確的那個 = 不鏡像 + 90°。
             ⇒ 教訓:UV 方向這種事,**排列組合看一次**比推理三輪快,而且不會錯。

           ★ 為什麼這個 bug 很容易活著上線:3D 斜看時大腦會自動補正,而且象棋有一半的字
             (車/士/兵/王)接近對稱,轉了也看不太出來 ⇒ 掃一眼就放它過關。
             驗收一定要「2D 正上方 + 放大 + 對著不對稱的字(馬/象/將)」看。 */
        texture.center.set(0.5, 0.5);
        texture.rotation = Math.PI / 2;
        return texture;
    }
    
    createPieceMesh(piece) {
        const geometry = new THREE.CylinderGeometry(this.PIECE_RADIUS, this.PIECE_RADIUS, this.PIECE_HEIGHT, 32);
        // Cylinder 預設是立著的，沿著 Y 軸。我們要讓它躺平在棋盤上，並旋轉 90 度使得頂部朝上 (Z軸正向)
        geometry.rotateX(Math.PI / 2);
        
        const texture = this.createPieceTexture(piece.name, piece.color === 'red');
        
        // 材質陣列：側面使用木頭色，頂面使用帶有文字的紋理
        const greenRim = new THREE.MeshPhongMaterial({ color: this.PALETTE.pieceSide });
        const materials = [
            greenRim,                                       // 側面 = 綠(使用者指定的「綠底棋子」)
            new THREE.MeshPhongMaterial({ map: texture }),  // 頂面 = 象牙白 + 字
            greenRim                                        // 底面
        ];
        
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // 附加棋子資料供射線檢測使用
        mesh.userData = { piece: piece };
        return mesh;
    }
    
    updateBoardState(board) {
        // 清除舊的棋子 meshes
        for (const key in this.pieceMeshes) {
            this.scene.remove(this.pieceMeshes[key]);
        }
        this.pieceMeshes = {};
        
        // 根據 board 狀態建立新的棋子
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 9; col++) {
                const piece = board[row][col];
                if (piece) {
                    const mesh = this.createPieceMesh(piece);
                    const pos = this.getGridPosition(row, col);
                    mesh.position.set(pos.x, pos.y, this.PIECE_HEIGHT / 2 + 0.1);
                    this.scene.add(mesh);
                    this.pieceMeshes[`${row},${col}`] = mesh;
                }
            }
        }
    }
    
    onMouseClick(event) {
        /* 正規化設備座標 (-1 ~ +1)。
           ⚠⚠ 一定要用**畫布本身**的 bounding rect,不可以用 window ——
             對局場的畫布住在版面裡(右邊還有資訊欄、上面有標題列),
             拿視窗尺寸換算的話**每一次點擊都會落在錯的格子上**,而且偏移量隨版面變。
             這和 fitCamera 是同一個病根(舊版線上那支兩處都用 window)。 */
        if (!this.renderer) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // 檢測與場景中所有物件的交集
        const intersects = this.raycaster.intersectObjects(this.scene.children);
        
        if (intersects.length > 0) {
            // 尋找被點擊的棋子或隱形點擊面
            let clickedObj = null;
            let intersectPoint = null;
            
            for (const intersect of intersects) {
                if (intersect.object.userData && intersect.object.userData.piece) {
                    clickedObj = intersect.object;
                    intersectPoint = intersect.point;
                    break;
                } else if (intersect.object.name === "ClickPlane") {
                    clickedObj = intersect.object;
                    intersectPoint = intersect.point;
                    // 如果有棋子在前面，通常會先被檢測到
                }
            }
            
            if (clickedObj) {
                let gridPos;
                if (clickedObj.name === "ClickPlane") {
                    // 點擊空地
                    gridPos = this.getGridIndex(intersectPoint.x, intersectPoint.y);
                } else {
                    // 點擊棋子，從 userData 中獲取 (或從位置反推)
                    gridPos = this.getGridIndex(clickedObj.position.x, clickedObj.position.y);
                }
                
                if (gridPos && this.onPieceClick) {
                    this.onPieceClick(gridPos.row, gridPos.col);
                }
            }
        }
    }
    
    highlightSquare(row, col) {
        this.clearHighlights();
        
        const pos = this.getGridPosition(row, col);
        const geo = new THREE.RingGeometry(this.PIECE_RADIUS + 0.5, this.PIECE_RADIUS + 1.7, 32);
        // 選取環同樣要壓在最上層:被選中的格子**一定**有棋子,不抬起來就看不見
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00ff00, side: THREE.DoubleSide, transparent: true, depthTest: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 11;
        mesh.position.set(pos.x, pos.y, this.PIECE_HEIGHT + 0.6);
        this.scene.add(mesh);
        this.highlightMeshes.push(mesh);
    }
    
    /* 標出可以走到的位置。
       ⚠⚠ 空格與「有敵子的格」要畫不一樣的東西:
         空格畫小綠點就好;但**目標上有棋子時,小綠點會整個被壓在棋子底下看不見**
         —— 首次截圖驗收就是這樣:提示說「吃掉對方的馬」,而那顆馬上面什麼都沒有,
         使用者只會覺得提示在亂講。⇒ 有子的格改畫一圈**比棋子大**的綠環,
         而且抬到棋子上方(z 高於棋高),不管有沒有子都看得到。 */
    highlightMoves(moves) {
        moves.forEach(move => {
            const pos = this.getGridPosition(move.row, move.col);
            const occupied = Boolean(this.pieceMeshes[`${move.row},${move.col}`]);
            const geo = occupied
                ? new THREE.RingGeometry(this.PIECE_RADIUS + 0.4, this.PIECE_RADIUS + 1.6, 32)
                : new THREE.CircleGeometry(1.6, 20);
            const mat = new THREE.MeshBasicMaterial({
                color: occupied ? 0x22cc44 : 0x00ff00,
                transparent: true,
                opacity: occupied ? 0.95 : 0.65,
                side: THREE.DoubleSide,
                depthTest: false,          // 一律畫在最上層,不被棋子擋掉
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.renderOrder = 10;
            mesh.position.set(pos.x, pos.y, occupied ? this.PIECE_HEIGHT + 0.8 : 0.5);
            this.scene.add(mesh);
            this.highlightMeshes.push(mesh);
        });
    }
    
    clearHighlights() {
        this.highlightMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.highlightMeshes = [];
    }
    
    movePiece(fromRow, fromCol, toRow, toCol, callback) {
        // 為了簡單起見，直接更新狀態並呼叫 callback。
        // 在 Milestone 4 可以加入 Tween.js 做平滑動畫。
        // 這裡暫時實作一個非常簡單的線性移動動畫
        
        const mesh = this.pieceMeshes[`${fromRow},${fromCol}`];
        if (!mesh) {
            if (callback) callback();
            return;
        }
        
        const startPos = mesh.position.clone();
        const endPosGrid = this.getGridPosition(toRow, toCol);
        const endPos = new THREE.Vector3(endPosGrid.x, endPosGrid.y, this.PIECE_HEIGHT / 2 + 0.1);
        
        this.animatingPieces.push({
            mesh: mesh,
            startPos: startPos,
            endPos: endPos,
            startTime: performance.now(),
            duration: 300, // 300 毫秒
            callback: callback
        });
    }
    
    // 畫布真正的可用尺寸(容器,不是視窗)。容器還沒佈局好時給一個不會除以 0 的保底值。
    containerSize() {
        const w = this.container.clientWidth || 640;
        const h = this.container.clientHeight || 480;
        return { w, h };
    }

    /* 把相機拉到「整張棋盤一定看得完」的距離。
       ★ 用算的,不是挑一個看起來剛好的數字 —— 挑數字只在寫它的那台機器的那個視窗寬度對,
         換一個版面就爆板(舊版就是這樣被切掉底線的)。
       垂直方向:d = (H/2) / tan(fov/2);水平方向再除以 aspect,兩者取大的。
       3D 是斜看,投影面比正上方大,所以多留一點餘裕。 */
    fitCamera() {
        if (!this.camera) return;
        const { w, h } = this.containerSize();
        const aspect = w / h;
        const halfFov = (this.camera.fov * Math.PI) / 180 / 2;

        /* 棋盤外圍留半格邊 —— 留太多就是畫面上一大片空的深色,
           留太少棋子會貼著邊緣(平板上手指還會蓋掉)。半格是量過的折衷。 */
        const boardW = this.BOARD_WIDTH + this.SQUARE_SIZE_X * 0.5;
        const boardH = this.BOARD_HEIGHT + this.SQUARE_SIZE_Y * 0.5;

        const distForH = (boardH / 2) / Math.tan(halfFov);
        const distForW = (boardW / 2) / Math.tan(halfFov) / aspect;
        let dist = Math.max(distForH, distForW) * 1.02;

        if (this.viewMode === '2d') {
            this.camera.position.set(0, 0, dist);
            // 2D 的「旋轉」= 轉相機的 up 向量(棋盤本身不動,子的貼圖才不會跟著歪)
            const rad = (this.boardSpin * Math.PI) / 180;
            this.camera.up.set(Math.sin(rad), Math.cos(rad), 0);
        } else {
            /* 斜看時棋盤的投影比正上方**矮**(前後被壓縮),所以不必退太遠;
               1.06 是量出來的:再小四個角會出框(browser-check 那條會紅)。 */
            dist *= 1.06;
            /* ★★ 2026-09-09 **回退** 0908 那個「直向把相機壓向正上方」的改動,理由是量出來的:
               390×844 直向全螢幕,投影四角的包圍盒 ——
                 俯角 56°(這一行)→ 棋盤 **354**×260     俯角 74°(0908 那版)→ 棋盤 327×288
               ⇒ 高 +28px、寬 **−27px**,面積只多 2%。而棋子大小是看**寬**的
                 (九條直線分寬度:354/9 = 39px vs 327/9 = 36px)⇒ 0908 那版的棋子其實**小了 8%**,
                 和它自己的改版簡歷寫的「棋子更大」剛好相反(已在 v11 的簡歷更正)。
               ⇒ 俯角一律 56°(和桌機同一個,0902 以來就是這個值)。
               ⚠ 這一條**不是** 0909「旋轉太靈敏」的病因 —— 那個病因是 rotateSpeed 預設 1.0
                 (見上面 controls 那段)。我一度以為是「相機貼著極點」,量完才知道
                 這支的公轉軸是 Y 不是 Z,0908 那版離公轉極點反而更遠。兩件事要分開講。 */
            this.camera.position.set(0, -dist * 0.52, dist * 0.78);
            this.camera.up.set(0, 0, 1);
        }
        this.camera.lookAt(0, 0, 0);
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.enableRotate = this.viewMode === '3d';   // 2D 不給轉,否則兩套控制打架
            /* ⚠ 別在這裡加 min/maxPolarAngle 的「避開正上方極點」保護(0909 試過又拿掉):
               OrbitControls 的 quat 是**建構時**照 `object.up` 算一次就凍住的
               (r128 的 update 是 IIFE,quat 在 return function 之前算),
               而這裡的相機是**先建 camera(up 還是預設 0,1,0)、後才把 up 設成 (0,0,1)**
               ⇒ 它的公轉軸其實是 **Y**、不是 Z。所以 `getPolarAngle()` 是從 +Y 量的,
                 minPolarAngle 擋的不是「正上方」而是「黑方那一側的水平方向」——
                 加了會擋錯地方,而註解還會騙下一手。要真的修得先統一 up,那是另一件事。 */
            this.controls.update();
        }
    }

    setViewMode(mode) {
        this.viewMode = mode === '2d' ? '2d' : '3d';
        if (this.viewMode === '3d') this.boardSpin = 0;   // 回 3D 時把 2D 的旋轉歸零
        this.fitCamera();
    }

    // 2D 左右轉(度)。只在 2D 有意義,3D 請直接用滑鼠拖。
    spinBoard(deltaDeg) {
        if (this.viewMode !== '2d') return false;
        this.boardSpin = (this.boardSpin + deltaDeg) % 360;
        this.fitCamera();
        return true;
    }

    resetView() {
        this.boardSpin = 0;
        this.fitCamera();
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        const { w, h } = this.containerSize();
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.fitCamera();          // 版面一變就重新裝一次,不然轉個方向就爆板
    }
    
    animate(time) {
        this.animationId = requestAnimationFrame(this.animate.bind(this));
        
        // 處理動畫
        if (this.animatingPieces.length > 0) {
            const currentTime = performance.now();
            for (let i = this.animatingPieces.length - 1; i >= 0; i--) {
                const anim = this.animatingPieces[i];
                const elapsed = currentTime - anim.startTime;
                const progress = Math.min(elapsed / anim.duration, 1);
                
                // 簡單的線性插值
                anim.mesh.position.lerpVectors(anim.startPos, anim.endPos, progress);
                // 可以加點拋物線高度效果
                if (progress < 1) {
                    anim.mesh.position.z += Math.sin(progress * Math.PI) * 5;
                }
                
                if (progress >= 1) {
                    anim.mesh.position.copy(anim.endPos);
                    if (anim.callback) anim.callback();
                    this.animatingPieces.splice(i, 1);
                }
            }
        }
        
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}