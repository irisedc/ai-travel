## AI Travel Planner（Web）

本项目为 HTML + CSS + JS ，集成：
- 高德地图（需在设置页填入 Web Key）
- 语音输入：优先 讯飞 SDK（需设置），无 Key 时回退为浏览器 Web Speech API
- 云端存储/认证：Supabase（设置页填入 URL/Anon Key；未配置时使用本地存储）
- 行程规划：默认内置简易规则生成器；可对接 LLM API（设置页填入）

### 快速开始
1. 克隆仓库后，直接打开 `public/index.html` 即可本地跑起来（不依赖打包工具）。
2. 点击右上角“设置”，填入以下可用项（可先只填高德 Key 体验地图与规则行程）：
   - 高德地图 Web Key（必填以显示地图）(c8681089ef9e49781b18865ff4f0d7c5)
   - 讯飞 AppId/Key/Secret（可选；不填则使用浏览器语音识别回退）(key:1b493fbe9971752dd8066a1c3352ca4f / Secret:NTUzZTg3YTkxMmI3ZDMyNDg3ZjBlZTk0)
   - Supabase URL / Anon Key（可选；不填则使用本地存储）(URL:https://xubcgobakbaxcvlezcae.supabase.co)(KEY:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YmNnb2Jha2JheGN2bGV6Y2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NDUxNTAsImV4cCI6MjA3ODUyMTE1MH0.2AcscQn_0dioDi78Kb5W21i8Gn8bT9ljlBBFKAZwdOg)
   - LLM API（可选；未填则用内置规则生成行程）(BASE:https://api.siliconflow.cn/v1 / KEY:sk-kdahbsrobwafdqdareuwpbujskpupelgtxvvgfnillbtdbcz / 模型：tencent/Hunyuan-MT-7B)
3. 语音按钮开始录音说出需求，如：“去上海 3 天，预算 3000，喜欢美食，参观经典”；或直接文本输入后点“生成行程”。

### 目录结构
```
ai-travel-planner/
  public/
    index.html
  src/
    styles.css
    settings.js
    map.js
    speech.js
    planner.js
    auth.js
    storage.js
    util.js
  Dockerfile
  nginx.conf
  .github/workflows/docker.yml
  README.md
```

### 本地开发（可选静态服务）
无需构建，任意静态服务器均可：
```bash
# 示例：用 Python 启动本地静态服务
cd ai-travel-planner/public
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

### Docker 运行
```bash
docker build -t ai-travel-planner:latest .
docker run -p 8080:80 ai-travel-planner:latest
# 打开 http://localhost:8080
```





