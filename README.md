<div align="center">
  <img width="1200" height="475" alt="Universal Tarot AI" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Universal Tarot AI —— 基于大模型的智能塔罗牌占卜系统

## 项目简介

这是一个基于 AI 大语言模型的塔罗牌占卜 Web 应用。用户可以通过网页端进行不同类型的塔罗牌占卜（每日一卡、三牌阵、六芒星阵），系统会调用 AI 模型对牌面进行解读，给出个性化的解读结果。

项目同时包含一个后台管理面板，用于管理用户数据、占卜记录和系统配置等。

## 主要功能

- 支持多种塔罗牌阵型（每日一卡 / 三牌阵 / 六芒星牌阵）
- 接入多个 AI 大模型（Gemini、DeepSeek 等），根据不同牌阵调用不同模型
- 用户注册登录、会员付费功能
- 后台管理系统（用户管理、数据统计、订单管理等）
- 响应式布局，支持移动端和桌面端

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| 样式方案 | Tailwind CSS |
| 动画 | Framer Motion |
| 后端/数据库 | Supabase（PostgreSQL + Edge Functions） |
| AI 模型接入 | Google Gemini API、SiliconFlow API |
| 部署 | Zeabur |

## 项目结构

```
universal-tarot-ai/
├── App.tsx              # 主应用组件
├── index.html           # 入口 HTML
├── index.tsx            # React 入口
├── constants.ts         # 常量配置
├── types.ts             # TypeScript 类型定义
├── components/          # 公共组件
├── services/            # 业务逻辑层（AI调用、支付、用户服务等）
├── admin/               # 后台管理系统（独立 Vite 项目）
├── supabase/            # Supabase Edge Functions 和 SQL 脚本
└── dist/                # 构建产物
```

## 本地运行

**环境要求：** Node.js >= 18

1. 安装依赖
   ```bash
   npm install
   ```

2. 配置环境变量，在 `.env.local` 文件中填入你的 API Key：
   ```
   GEMINI_API_KEY=你的API密钥
   ```

3. 启动开发服务器
   ```bash
   npm run dev
   ```

4. 浏览器打开 `http://localhost:3000` 即可访问

## 部分截图

> 待补充

## 致谢

- [React](https://react.dev/)
- [Supabase](https://supabase.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vite](https://vitejs.dev/)
