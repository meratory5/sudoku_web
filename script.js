// 数独ソルバークラス（Python版のSudokuSolverを参考）
class SudokuSolver {
    constructor(grid) {
        this.grid = grid.map(row => [...row]);
        this.solutions = [];
        this.maxSolutions = 2;
    }

    isValid(row, col, num) {
        // 行チェック
        if (this.grid[row].includes(num)) return false;

        // 列チェック
        for (let i = 0; i < 9; i++) {
            if (this.grid[i][col] === num) return false;
        }

        // 3x3ブロックチェック
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let i = boxRow; i < boxRow + 3; i++) {
            for (let j = boxCol; j < boxCol + 3; j++) {
                if (this.grid[i][j] === num) return false;
            }
        }

        return true;
    }

    solve() {
        this.solutions = [];
        this.stepCount = 0;
        this.maxSteps = 10000; // 最大ステップ数を制限
        this.solveRecursive();
        return this.solutions.length > 0 ? this.solutions[0] : null;
    }

    solveRecursive() {
        if (this.solutions.length >= this.maxSolutions) return;
        if (this.stepCount++ > this.maxSteps) return; // ステップ数制限

        const empty = this.findEmpty();
        if (!empty) {
            this.solutions.push(this.grid.map(row => [...row]));
            return;
        }

        const [row, col] = empty;
        for (let num = 1; num <= 9; num++) {
            if (this.isValid(row, col, num)) {
                this.grid[row][col] = num;
                this.solveRecursive();
                this.grid[row][col] = 0;
            }
        }
    }

    findEmpty() {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                if (this.grid[i][j] === 0) return [i, j];
            }
        }
        return null;
    }

    hasUniqueSolution() {
        this.solutions = [];
        this.maxSolutions = 2;
        this.solveRecursive();
        return this.solutions.length === 1;
    }
}

// 数独生成クラス（Python版のSudokuGeneratorを参考）
class SudokuGenerator {
    generateCompleteGrid() {
        const grid = Array(9).fill(0).map(() => Array(9).fill(0));
        this.fillGrid(grid);
        return grid;
    }

    fillGrid(grid) {
        const empty = this.findEmpty(grid);
        if (!empty) return true;

        const [row, col] = empty;
        const numbers = this.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);

        for (const num of numbers) {
            if (this.isValid(grid, row, col, num)) {
                grid[row][col] = num;
                if (this.fillGrid(grid)) return true;
                grid[row][col] = 0;
            }
        }
        return false;
    }

    findEmpty(grid) {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                if (grid[i][j] === 0) return [i, j];
            }
        }
        return null;
    }

    isValid(grid, row, col, num) {
        // 行チェック
        if (grid[row].includes(num)) return false;

        // 列チェック
        for (let i = 0; i < 9; i++) {
            if (grid[i][col] === num) return false;
        }

        // 3x3ブロックチェック
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let i = boxRow; i < boxRow + 3; i++) {
            for (let j = boxCol; j < boxCol + 3; j++) {
                if (grid[i][j] === num) return false;
            }
        }
        return true;
    }

    shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    async createPuzzle(difficulty = 'extreme', pattern = null) {
        const solution = this.generateCompleteGrid();
        const puzzle = solution.map(row => [...row]);

        // 全ての位置をリストアップ
        const positions = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                positions.push([i, j]);
            }
        }

        // 削除チェックの順番を決定
        if (pattern) {
            // パターンモード: 複数の層を外側から順にチェック
            const layers = this.getPatternLayers(pattern);

            positions.length = 0;
            // 各層をシャッフルしてから連結（外側→内側）
            for (const layer of layers) {
                const shuffledLayer = this.shuffle(layer);
                positions.push(...shuffledLayer);
            }
        } else {
            // 通常モード: 完全にランダム
            const shuffled = this.shuffle(positions);
            positions.length = 0;
            positions.push(...shuffled);
        }

        // 時間ベースのタイムアウト設定（30秒）
        const startTime = Date.now();
        const timeout = 30000; // 30秒

        // 順番通りに削除を試みる（一周のみ、またはタイムアウトまで）
        let checkedCount = 0;
        for (let i = 0; i < positions.length; i++) {
            // タイムアウトチェック
            if (Date.now() - startTime > timeout) {
                break;
            }

            const [row, col] = positions[i];
            const backup = puzzle[row][col];
            puzzle[row][col] = 0;

            const solver = new SudokuSolver(puzzle);
            if (!solver.hasUniqueSolution()) {
                puzzle[row][col] = backup;
            }

            // 5回に1回UIスレッドに制御を戻す
            checkedCount++;
            if (checkedCount % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const hintCount = puzzle.flat().filter(x => x !== 0).length;
        return { puzzle, solution, hintCount };
    }

    getPatternLayers(pattern) {
        const patterns = {
            checkerboard: () => this.checkerboardLayers(),
            heart: () => this.heartLayers(),
            star: () => this.starLayers(),
            topleft: () => this.topLeftLayers(),
            diagonal: () => this.diagonalLayers(),
            cross: () => this.crossLayers(),
            frame: () => this.frameLayers()
        };
        const func = patterns[pattern] || patterns.checkerboard;
        return func();
    }

    heartLayers() {
        // ハート型：中心から外側へ層を分ける
        const core = [[6, 4], [5, 3], [5, 4], [5, 5]]; // 最内層（約4マス）
        const layer1 = [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6]]; // 5マス
        const layer2 = [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7]]; // 7マス
        const layer3 = [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8]]; // 9マス
        const layer4 = [[1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [0, 2], [0, 3], [0, 5], [0, 6]]; // 10マス
        const outer = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const pos = [i, j];
                const inCore = core.some(([r, c]) => r === i && c === j);
                const inL1 = layer1.some(([r, c]) => r === i && c === j);
                const inL2 = layer2.some(([r, c]) => r === i && c === j);
                const inL3 = layer3.some(([r, c]) => r === i && c === j);
                const inL4 = layer4.some(([r, c]) => r === i && c === j);
                if (!inCore && !inL1 && !inL2 && !inL3 && !inL4) {
                    outer.push(pos);
                }
            }
        }
        return [outer, layer4, layer3, layer2, layer1, core];
    }

    starLayers() {
        // 星型：中心から放射状に層を分ける
        const center = [[4, 4]]; // 中心点
        const layer1 = [[0, 4], [2, 2], [2, 6], [6, 2], [6, 6], [8, 4]]; // 星の6つの頂点
        const layer2 = [[1, 4], [3, 4], [5, 4], [7, 4], [4, 1], [4, 7], [2, 3], [2, 5], [3, 2], [3, 6], [5, 2], [5, 6], [6, 3], [6, 5]]; // 頂点の内側
        const layer3 = [[4, 2], [4, 6], [2, 4], [6, 4], [3, 3], [3, 5], [5, 3], [5, 5]]; // さらに内側
        const outer = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const pos = [i, j];
                const inCenter = center.some(([r, c]) => r === i && c === j);
                const inL1 = layer1.some(([r, c]) => r === i && c === j);
                const inL2 = layer2.some(([r, c]) => r === i && c === j);
                const inL3 = layer3.some(([r, c]) => r === i && c === j);
                if (!inCenter && !inL1 && !inL2 && !inL3) {
                    outer.push(pos);
                }
            }
        }
        return [outer, layer1, layer2, layer3, center];
    }

    topLeftLayers() {
        // 左上集中：左上からの距離で層を分ける（斜め45度の等距離線）
        const layers = [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const dist = i + j; // マンハッタン距離（斜め45度の等距離線）
                if (dist < layers.length) {
                    layers[dist].push([i, j]);
                }
            }
        }
        // 遠い層から順に返す（右下→左上）
        return layers.reverse().filter(layer => layer.length > 0);
    }

    diagonalLayers() {
        // 対角線：対角線を中心に層を分ける
        const diag = [];
        for (let i = 0; i < 9; i++) {
            diag.push([i, i]);
            if (i !== 4) diag.push([i, 8 - i]);
        }
        const layer1 = [[1, 0], [0, 1], [1, 8], [0, 7], [7, 0], [8, 1], [7, 8], [8, 7],
                        [2, 1], [1, 2], [2, 7], [1, 6], [6, 1], [7, 2], [6, 7], [7, 6]];
        const layer2 = [[3, 2], [2, 3], [3, 6], [2, 5], [5, 2], [6, 3], [5, 6], [6, 5]];
        const outer = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const pos = [i, j];
                const inDiag = diag.some(([r, c]) => r === i && c === j);
                const inL1 = layer1.some(([r, c]) => r === i && c === j);
                const inL2 = layer2.some(([r, c]) => r === i && c === j);
                if (!inDiag && !inL1 && !inL2) {
                    outer.push(pos);
                }
            }
        }
        return [outer, layer2, layer1, diag];
    }

    crossLayers() {
        // 十字：十字を中心に層を分ける
        const cross = [];
        for (let i = 0; i < 9; i++) {
            cross.push([i, 4], [4, i]);
        }
        const layer1 = [[3, 3], [3, 5], [5, 3], [5, 5], [2, 4], [6, 4], [4, 2], [4, 6]];
        const layer2 = [[2, 3], [2, 5], [3, 2], [3, 6], [5, 2], [5, 6], [6, 3], [6, 5]];
        const outer = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const pos = [i, j];
                const inCross = cross.some(([r, c]) => r === i && c === j);
                const inL1 = layer1.some(([r, c]) => r === i && c === j);
                const inL2 = layer2.some(([r, c]) => r === i && c === j);
                if (!inCross && !inL1 && !inL2) {
                    outer.push(pos);
                }
            }
        }
        return [outer, layer2, layer1, cross];
    }

    frameLayers() {
        // 額縁：外枠から内側へ同心正方形
        const frame0 = [];
        for (let i = 0; i < 9; i++) {
            frame0.push([0, i], [8, i]);
            if (i !== 0 && i !== 8) {
                frame0.push([i, 0], [i, 8]);
            }
        }
        const frame1 = [];
        for (let i = 1; i < 8; i++) {
            frame1.push([1, i], [7, i]);
            if (i !== 1 && i !== 7) {
                frame1.push([i, 1], [i, 7]);
            }
        }
        const frame2 = [];
        for (let i = 2; i < 7; i++) {
            frame2.push([2, i], [6, i]);
            if (i !== 2 && i !== 6) {
                frame2.push([i, 2], [i, 6]);
            }
        }
        const frame3 = [];
        for (let i = 3; i < 6; i++) {
            frame3.push([3, i], [5, i]);
            if (i !== 3 && i !== 5) {
                frame3.push([i, 3], [i, 5]);
            }
        }
        const center = [[4, 4]];
        return [frame0, frame1, frame2, frame3, center];
    }

    checkerboardLayers() {
        // 市松模様：市松パターン（内側外側の概念なし）
        const checkPositions = [];
        const nonCheckPositions = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                if ((i + j) % 2 === 0) {
                    checkPositions.push([i, j]);
                } else {
                    nonCheckPositions.push([i, j]);
                }
            }
        }
        // 非市松模様の位置を先に、市松模様の位置を後に
        return [nonCheckPositions, checkPositions];
    }
}

// ゲームクラス
class SudokuGame {
    constructor() {
        this.puzzle = null;
        this.solution = null;
        this.userGrid = null;
        this.userMemos = null; // 各セルのメモ（Set配列）
        this.selectedCell = null;
        this.startTime = null;
        this.timerInterval = null;
        this.memoMode = false; // メモモードフラグ
        this.errorCells = new Set(); // エラーセルのインデックスを保存

        this.initializeUI();
        this.attachEventListeners();
        this.newGame();
    }

    initializeUI() {
        const board = document.getElementById('game-board');
        board.innerHTML = '';

        for (let i = 0; i < 81; i++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.index = i;
            cell.addEventListener('click', () => this.selectCell(i));
            board.appendChild(cell);
        }
    }

    attachEventListeners() {
        document.getElementById('new-game-btn').addEventListener('click', () => this.newGame());
        document.getElementById('extreme-btn').addEventListener('click', () => this.newGameExtreme());
        document.getElementById('check-btn').addEventListener('click', () => this.checkSolution());
        document.getElementById('solve-btn').addEventListener('click', () => this.showSolution());
        document.getElementById('memo-mode-btn').addEventListener('click', () => this.toggleMemoMode());

        document.querySelectorAll('.num-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const num = parseInt(btn.dataset.num);
                this.placeNumber(num);
            });
        });

        // キーボード入力
        document.addEventListener('keydown', (e) => {
            if (e.key >= '1' && e.key <= '9') {
                this.placeNumber(parseInt(e.key));
            } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
                this.placeNumber(0);
            } else if (e.key === 'm' || e.key === 'M') {
                this.toggleMemoMode();
            }
        });
    }

    async newGame() {
        this.showMessage('数独を生成中...', 'info');

        // UI更新を待つ
        await new Promise(resolve => setTimeout(resolve, 100));

        // 3秒後にメッセージを追加
        const longTimeout = setTimeout(() => {
            this.showMessage('数独を生成中...\n\n生成に時間がかかっています', 'info');
        }, 3000);

        const generator = new SudokuGenerator();
        const result = await generator.createPuzzle('extreme');

        clearTimeout(longTimeout);

        this.puzzle = result.puzzle;
        this.solution = result.solution;
        this.userGrid = this.puzzle.map(row => [...row]);
        this.userMemos = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.selectedCell = null;

        document.getElementById('hint-count').textContent = result.hintCount;
        document.getElementById('pattern-hint').textContent = ''; // 通常モードはパターンなし

        this.renderBoard();
        this.startTimer();
        this.hideMessage();
    }

    async newGameExtreme() {
        this.showMessage('EXTREME MODE!\n生成中...', 'info');

        // UI更新を待つ
        await new Promise(resolve => setTimeout(resolve, 100));

        // 3秒後にメッセージを追加
        const longTimeout = setTimeout(() => {
            this.showMessage('EXTREME MODE!\n生成中...\n\n生成に時間がかかっています', 'info');
        }, 3000);

        // ランダムなパターンを選択
        const patterns = ['checkerboard', 'heart', 'star', 'topleft', 'diagonal', 'cross', 'frame'];
        const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];

        const generator = new SudokuGenerator();
        const result = await generator.createPuzzle('extreme', randomPattern);

        clearTimeout(longTimeout);

        this.puzzle = result.puzzle;
        this.solution = result.solution;
        this.userGrid = this.puzzle.map(row => [...row]);
        this.userMemos = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.selectedCell = null;

        document.getElementById('hint-count').textContent = result.hintCount;

        // パターン名を極小で表示
        const patternNames = {
            'checkerboard': '市松模様',
            'heart': 'ハート',
            'star': '星',
            'topleft': '左上',
            'diagonal': '対角線',
            'cross': '十字',
            'frame': '額縁'
        };
        document.getElementById('pattern-hint').textContent = patternNames[randomPattern] || randomPattern;

        this.renderBoard();
        this.startTimer();
        this.hideMessage();
    }

    renderBoard() {
        const cells = document.querySelectorAll('.cell');
        cells.forEach((cell, index) => {
            const row = Math.floor(index / 9);
            const col = index % 9;
            const value = this.userGrid[row][col];

            // セルの内容をクリア
            cell.innerHTML = '';
            cell.className = 'cell';

            // 本物の数字がある場合
            if (value !== 0) {
                cell.textContent = value;
            } else if (this.userMemos[row][col].size > 0) {
                // メモがある場合：1-9を固定位置に表示
                const memosDiv = document.createElement('div');
                memosDiv.className = 'cell-memos';

                // 1-9まで順番に表示（位置は固定：1=左上、2=上中央、3=右上、4=左中央...）
                for (let num = 1; num <= 9; num++) {
                    const memoSpan = document.createElement('span');
                    memoSpan.className = 'cell-memo';
                    // メモがある場合のみ数字を表示、ない場合は空
                    if (this.userMemos[row][col].has(num)) {
                        memoSpan.textContent = num;
                    } else {
                        memoSpan.textContent = '';
                    }
                    memosDiv.appendChild(memoSpan);
                }

                cell.appendChild(memosDiv);
            }

            if (this.puzzle[row][col] !== 0) {
                cell.classList.add('fixed');
            }

            if (index === this.selectedCell) {
                cell.classList.add('selected');
            }

            // エラーセルの表示
            if (this.errorCells.has(index)) {
                cell.classList.add('error');
            }
        });
    }

    toggleMemoMode() {
        this.memoMode = !this.memoMode;
        const btn = document.getElementById('memo-mode-btn');
        btn.textContent = this.memoMode ? 'メモモード: ON' : 'メモモード: OFF';
        btn.style.background = this.memoMode ? '#000' : '#fff';
        btn.style.color = this.memoMode ? '#fff' : '#000';
    }

    selectCell(index) {
        const row = Math.floor(index / 9);
        const col = index % 9;

        if (this.puzzle[row][col] !== 0) return; // 固定セルは選択不可

        // このセルのエラー表示をクリア
        this.errorCells.delete(index);

        this.selectedCell = index;
        this.renderBoard();
    }

    placeNumber(num) {
        if (this.selectedCell === null) return;

        const row = Math.floor(this.selectedCell / 9);
        const col = this.selectedCell % 9;

        if (this.puzzle[row][col] !== 0) return; // 固定セルは変更不可

        // このセルのエラー表示をクリア
        this.errorCells.delete(this.selectedCell);

        if (this.memoMode) {
            // メモモード
            if (num === 0) {
                // ×ボタン：メモを全削除
                this.userMemos[row][col].clear();
            } else {
                // 数字：トグル（追加/削除）
                if (this.userMemos[row][col].has(num)) {
                    this.userMemos[row][col].delete(num);
                } else {
                    this.userMemos[row][col].add(num);
                }
            }
        } else {
            // 通常モード
            this.userGrid[row][col] = num;
            // 本物の数字を入れたらメモを消す
            if (num !== 0) {
                this.userMemos[row][col].clear();
            }
        }

        this.renderBoard();

        // 完成チェック
        if (this.isComplete()) {
            this.checkSolution();
        }
    }

    isComplete() {
        return this.userGrid.every(row => row.every(cell => cell !== 0));
    }

    checkSolution() {
        let hasError = false;
        this.errorCells.clear(); // エラーセルをリセット

        for (let index = 0; index < 81; index++) {
            const row = Math.floor(index / 9);
            const col = index % 9;
            const userValue = this.userGrid[row][col];
            const correctValue = this.solution[row][col];

            if (userValue !== 0 && this.puzzle[row][col] === 0) {
                if (userValue !== correctValue) {
                    this.errorCells.add(index);
                    hasError = true;
                }
            }
        }

        this.renderBoard(); // エラー表示を反映

        if (this.isComplete() && !hasError) {
            this.stopTimer();
            this.showMessage('完成！', 'success');
        } else if (hasError) {
            this.showMessage('間違いあり', 'error');
        } else {
            this.showMessage('正解', 'success');
        }
    }

    showSolution() {
        if (confirm('解答を表示しますか？')) {
            this.userGrid = this.solution.map(row => [...row]);
            this.renderBoard();
            this.stopTimer();
            this.showMessage('解答を表示しました', 'info');
        }
    }

    startTimer() {
        this.startTime = Date.now();
        this.stopTimer();
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimer() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        document.getElementById('timer').textContent = `${minutes}:${seconds}`;
    }

    showMessage(text, type) {
        const msgElement = document.getElementById('status-message');
        msgElement.textContent = text;
        msgElement.className = `status-message show ${type}`;

        // クリックまたはキー入力で即座に消す
        const dismissHandler = () => {
            this.hideMessage();
            document.removeEventListener('click', dismissHandler);
            document.removeEventListener('keydown', dismissHandler);
        };

        // 少し遅延させてからイベントリスナーを設定（メッセージ表示直後のクリックを無視）
        setTimeout(() => {
            document.addEventListener('click', dismissHandler, { once: true });
            document.addEventListener('keydown', dismissHandler, { once: true });
        }, 100);
    }

    hideMessage() {
        const msgElement = document.getElementById('status-message');
        msgElement.className = 'status-message';
    }
}

// ゲーム開始
let game;
window.addEventListener('DOMContentLoaded', () => {
    game = new SudokuGame();
});
