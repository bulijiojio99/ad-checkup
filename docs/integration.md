# 网站接入说明

如何把投流体检构建成静态网页，放到你自己的网站上。它是纯静态网页，即用即分析，不联网，也不收集任何数据。

源代码：<https://github.com/bulijiojio99/ad-checkup>

## 一、构建网页

环境：Node 22.12 或更高。

```bash
git clone https://github.com/bulijiojio99/ad-checkup.git
cd ad-checkup
npm install --legacy-peer-deps
npm run build
```

产物在 `dist/` 目录（`index.html` 和 `assets/`），整体上传到任何 Web 服务器或对象存储即可，不需要服务端。

注意：

- 网页使用相对路径，放在子域名（如 `tool.你的网站.com`）或子目录（如 `你的网站.com/tool/`）都可以。
- 构建时会在 `index.html` 里写入内容安全策略 `connect-src 'none'`，页面在技术上无法向任何服务器发送数据。**不要修改或删除这条策略**，隐私政策里的承诺依赖它。
- 建议开启 HTTPS。

## 二、在网站上展示

推荐做法：网站放介绍和入口按钮，链接到工具页面（子域名或子目录）。

如果一定要用 iframe 嵌入：

```html
<iframe src="https://tool.你的网站.com/" title="投流体检" style="width:100%;min-height:1200px;border:0" allow="clipboard-write"></iframe>
```

- `allow="clipboard-write"` 用于“复制 AI 提示词”按钮（只复制到剪贴板，不联网）。
- 工具内部用地址里的 `#/terms`、`#/privacy` 展示使用协议和隐私政策，可以直接链接 `https://tool.你的网站.com/#/privacy`。

可以用于宣传的素材：

- 产品名：投流体检
- 一句话介绍：上传亚马逊、抖音千川、小红书的广告报表，找出有统计依据的低效花费。报表只在你的浏览器里计算。
- 演示方法：打开工具，选择平台后点“用模拟数据看看效果”，即可看到完整报告（模拟数据，不是真实店铺）。

## 三、上线前检查

- [ ] 隐私政策、使用协议中的【】占位符已填写（`docs/legal/`），并经律师审阅
- [ ] 构建出的 `index.html` 里有 `connect-src 'none'`
