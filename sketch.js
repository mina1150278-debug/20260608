let video;
let handpose;
let predictions = [];
let modelLoaded = false; // 用於自我檢查模型載入狀態
let gameState = "WAITING"; // 遊戲狀態：WAITING, PLAY, GAMEOVER
let playerX; // 角色的平滑 X 座標
let targetX; // 手指偵測到的目標 X 座標
let fallingObjects = []; // 掉落物陣列
let particles = []; // 爆炸粒子陣列
let floatingTexts = []; // 漂浮文字特效陣列
let score = 0; // 分數
let hp = 3; // 生命值
let fallSpeedMultiplier = 1; // 掉落速度倍率
const playerWidth = 120; // 角色寬度

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO);
  video.size(width, height);

  // 1. 初始化 Handpose 模型 (修正：v1.x 版為 handPose，大寫 P)
  handpose = ml5.handPose(video, () => {
    modelLoaded = true;
    console.log("Model Ready!");
    // 2. 修正：v1.x 建議使用 detectStart 來啟動持續偵測
    handpose.detectStart(video, (results) => {
      predictions = results;
    });
  });

  // 隱藏原始的 HTML 影片元件，我們要在畫布上繪製
  video.hide();

  playerX = width / 2;
  targetX = width / 2;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  video.size(width, height);
}

function draw() {
  // 確保每一幀都先清空畫布，避免產生黃色軌跡
  background(255);

  // 1. 處理水平鏡像：將畫布原點移至右側並翻轉 X 軸
  translate(width, 0);
  scale(-1, 1);

  // 繪製攝影機畫面
  image(video, 0, 0, width, height);

  // 2. 偵測邏輯
  if (predictions.length > 0) {
    // 取得第一隻偵測到的手
    let hand = predictions[0];
    
    // 3. 更新食指尖端座標 (新版資料結構：hand.index_finger_tip)
    let indexFinger = hand.index_finger_tip;
    
    // 更新目標座標 (用於平滑跟隨)
    targetX = indexFinger.x;

    // 在食指尖端畫一個小圓點，方便確認偵測位置
    fill(0, 255, 0);
    noStroke();
    ellipse(indexFinger.x, indexFinger.y, 15, 15);
    
    // 檢查是否「手部打開」以重新開始遊戲
    if (gameState === "GAMEOVER") {
      let isOpen = hand.index_finger_tip.y < hand.index_finger_pip.y &&
                   hand.middle_finger_tip.y < hand.middle_finger_pip.y &&
                   hand.ring_finger_tip.y < hand.ring_finger_pip.y &&
                   hand.pinky_finger_tip.y < hand.pinky_finger_pip.y;
      
      if (isOpen) {
        resetGame();
        gameState = "PLAY";
      }
    }

    // 如果目前在等待狀態且偵測到手，就開始遊戲
    if (gameState === "WAITING") {
      resetGame();
      gameState = "PLAY";
    }
  }

  // 自我檢查 UI (不論遊戲狀態，都顯示在最上層)
  push();
  scale(-1, 1);
  translate(-width, 0);
  fill(0);
  textSize(14);
  textAlign(LEFT);
  let statusText = !modelLoaded ? "🔄 模型載入中..." : (predictions.length > 0 ? "✅ 偵測中 (手部已發現)" : "❌ 未偵測到手部");
  text("狀態: " + statusText, 20, 30);
  pop();

  if (gameState === "WAITING") {
    // 等待偵測的畫面
    push();
    scale(-1, 1);
    translate(-width, 0);
    fill(0);
    textAlign(CENTER);
    textSize(24);
    text(!modelLoaded ? "Model Loading..." : "Ready! Please show your hand.", width / 2, height / 2);
    textSize(16);
    text("Please show your hand to the camera to start", width / 2, height / 2 + 40);
    pop();
  } else if (gameState === "PLAY") {
    // --- 1. 玩家控制邏輯 ---
    playerX = lerp(playerX, targetX, 0.15);
    playerX = constrain(playerX, playerWidth / 2, width - playerWidth / 2);

    // --- 2. 處理特效更新 ---
    // 更新粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update();
      particles[i].display();
      if (particles[i].finished()) particles.splice(i, 1);
    }
    // 更新漂浮文字
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      floatingTexts[i].update();
      floatingTexts[i].display();
      if (floatingTexts[i].finished()) floatingTexts.splice(i, 1);
    }

    // --- 3. 繪製盤子 ---
    fill(hp > 1 ? 220 : color(255, 100, 100)); // 血量低時盤子變紅
    stroke(100);
    strokeWeight(2);
    rectMode(CENTER);
    arc(playerX, height - 65, playerWidth, 40, 0, PI, CHORD);
    rect(playerX, height - 43, playerWidth * 0.5, 8, 2);

    // --- 4. 生成與更新掉落物 ---
    if (frameCount % 60 === 0) {
      let type = random(1) < 0.8 ? "fruit" : "boom"; // 80% 水果, 20% 炸彈
      fallingObjects.push(new FallingObject(type));
    }

    // 更新與檢查所有掉落物
    for (let i = fallingObjects.length - 1; i >= 0; i--) {
      let obj = fallingObjects[i];
      obj.update(fallSpeedMultiplier);
      obj.display();

      // 碰撞偵測 (盤子頂部高度約在 height-65)
      if (obj.y > height - 85 && obj.y < height - 45 && 
          abs(obj.x - playerX) < playerWidth / 2) {
        
        if (obj.type === "fruit") {
          score += 10;
          floatingTexts.push(new FloatingText(obj.x, obj.y, "+10"));
        } else {
          hp -= 1;
          // 產生 15-20 個爆炸粒子
          let count = random(15, 20);
          for (let j = 0; j < count; j++) {
            particles.push(new Particle(obj.x, obj.y));
          }
          if (hp <= 0) gameState = "GAMEOVER";
        }
        fallingObjects.splice(i, 1);
        continue;
      }

      // 如果掉出畫面底部，則移除物件以節省記憶體
      if (obj.y > height + 50) {
        fallingObjects.splice(i, 1);
      }
    }

    // --- 5. 難度調整 ---
    fallSpeedMultiplier = 1 + (score / 50);

    // --- 6. 顯示 UI ---
    push();
    scale(-1, 1); // 翻轉回正常文字方向
    translate(-width, 0);
    fill(50);
    noStroke();
    rectMode(CORNER);
    // 繪製半透明背景框
    fill(255, 150);
    rect(10, 50, 180, 70, 10);
    fill(0);
    textSize(24);
    textAlign(LEFT);
    text("Score: " + score, 25, 80);
    // HP 顯示，危險時變紅色
    if (hp === 1) fill(255, 0, 0);
    text("HP: " + "❤️".repeat(hp), 25, 110);
    pop();

  } else {
    // 遊戲結束畫面 (需要處理鏡像文字問題)
    push();
    scale(-1, 1); // 再次翻轉回來讓文字正常
    translate(-width, 0);
    fill(0); // 將文字改為黑色
    textAlign(CENTER);
    textSize(48);
    text("GAME OVER", width / 2, height / 2);
    textSize(20);
    text("Open Hand to Restart", width / 2, height / 2 + 50);
    pop();
  }
}

function resetGame() {
  fallingObjects = [];
  particles = [];
  floatingTexts = [];
  score = 0;
  hp = 3;
  fallSpeedMultiplier = 1;
  playerX = width / 2;
}

// --- 掉落物類別設計 ---
class FallingObject {
  constructor(type) {
    this.x = random(50, width - 50);
    this.y = -50; // 從畫面上方外面開始
    this.type = type; // "fruit" 或 "boom"
    this.size = 35;
    this.speed = random(3, 8); // 隨機基礎速度

    // 設定顏色
    if (this.type === "fruit") {
      let fruitColors = [
        [255, 50, 50],   // 紅色 (蘋果)
        [255, 150, 0],  // 橘色 (橘子)
        [255, 240, 50],  // 黃色 (香蕉)
        [140, 220, 50],  // 綠色 (葡萄)
        [180, 80, 255]   // 紫色 (紫葡萄)
      ];
      this.color = random(fruitColors);
    } else {
      this.color = [30, 30, 30]; // 炸彈為深黑色
    }
  }

  update(multiplier) {
    // 根據全域倍率讓物體掉落
    this.y += this.speed * multiplier;
  }

  display() {
    push();
    noStroke();
    fill(this.color);
    ellipse(this.x, this.y, this.size);
    
    // 增加一個小亮點讓它看起來更像圓球
    fill(255, 100);
    ellipse(this.x - this.size/4, this.y - this.size/4, this.size/3);
    pop();
  }
}

// --- 爆炸粒子類別 ---
class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = random(-5, 5);
    this.vy = random(-5, 5);
    this.alpha = 255;
    this.size = random(4, 8);
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 10; // 逐漸消失
  }

  finished() {
    return this.alpha < 0;
  }

  display() {
    push();
    noStroke();
    fill(0, this.alpha);
    ellipse(this.x, this.y, this.size);
    pop();
  }
}

// --- 漂浮文字特效 ---
class FloatingText {
  constructor(x, y, txt) {
    this.x = x;
    this.y = y;
    this.txt = txt;
    this.alpha = 255;
  }

  update() {
    this.y -= 2; // 向上飄
    this.alpha -= 5;
  }

  finished() {
    return this.alpha < 0;
  }

  display() {
    push();
    // 文字也需要處理鏡像
    translate(this.x, this.y);
    scale(-1, 1); 
    fill(50, 200, 50, this.alpha);
    noStroke();
    textSize(32);
    textStyle(BOLD);
    textAlign(CENTER);
    text(this.txt, 0, 0);
    pop();
  }
}
