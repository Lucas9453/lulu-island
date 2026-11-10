# 嚕嚕島 Lulu Island

國小英文單字小遊戲：聽英文、餵寵物嚕嚕吃果子。

- 玩：用瀏覽器打開網頁就能玩，不用安裝。
- 進度存在各自裝置的瀏覽器裡，不會上傳。
- 單字：五年級精選 246 字（第一版只開動物島 30 字）。

## 音樂與音效（都是 CC0 公眾領域素材，感謝作者）
- 背景音樂：Zane Little Music「Flowerbed Fields [Loop]」 https://opengameart.org/content/flowerbed-fields-loop
- 音效：Juhani Junkala（SubspaceAudio）「512 Sound Effects (8-bit style)」 https://opengameart.org/content/512-sound-effects-8-bit-style ；Kenney「Interface Sounds」「Music Jingles」 https://kenney.nl/assets
- 唸英文的時候背景音樂會自動靜音，唸完再回來；設定裡可以分開關掉音樂和音效。

## 3D 嚕嚕（v1.3）
- 模型：Tai 用 Tripo AI 從自己畫的嚕嚕生成（專業版匯出），減面後 `assets/model/lulu.glb`。
- 3D 繪圖：three.js 0.160.0（MIT License，Copyright 2010-2023 Three.js Authors），放在 `js/vendor/`，不從外部網址載入。
- 用 http/https 開才是 3D；雙擊 index.html、不支援 WebGL、載不動或跑不動時自動用 2D 嚕嚕，設定頁可以關掉 3D。
