# Durée

数字 1–9 像沙一样从上方落下，落进 9 个看不见的钟表里，被各自走着不同时间的指针扫落。
开场标题 Durée 会托住第一批数字，5 秒后淡出，数字随之落空。

## 交互

- 点一个表：选中并稍微放大
- 按住指针拖动、甩出：松手时的速度就是这根指针之后的转速（可以停下，也可以倒转）
- 点空白处或按 Esc：取消选中
- 按 R：清空所有数字

## 本地预览

直接双击 `index.html` 即可在浏览器里打开（需要联网加载 p5.js、matter.js 和字体）。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库（例如 `duree`），把这个文件夹里的所有文件上传到仓库根目录。
2. 进入仓库 **Settings → Pages**。
3. Source 选 **Deploy from a branch**，Branch 选 `main`、文件夹选 `/ (root)`，保存。
4. 等一两分钟，页面地址会显示在同一个设置页里，形如 `https://<你的用户名>.github.io/duree/`。

## 调整效果

所有参数都在 `sketch.js` 开头的 `CONFIG` 里，每一项都有中文注释：数字数量、表盘大小与间距、指针速度、标题停留时间等。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 页面，加载库和字体 |
| `sketch.js` | 全部作品代码（p5.js + matter.js） |
| `.nojekyll` | 让 GitHub Pages 原样发布文件 |

## 致谢

灵感与表盘布局来自 mathfoxLab 的 OpenProcessing 作品「sand animation」(#2777877)，原作以 CC BY-NC-SA 3.0 授权。本作品在此基础上改编，同样仅供非商业使用，并以相同协议共享。

使用的开源库：[p5.js](https://p5js.org)、[matter.js](https://brm.io/matter-js/)，字体 [Inter](https://rsms.me/inter/)。
