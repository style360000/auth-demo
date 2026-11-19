========================================================
  授权平台 Demo —— Cloudflare Pages 部署说明
========================================================

【先说最重要的一句】
这个网站有后端接口（注册 / 登录 / 发验证码 / 授权），都放在 functions/
目录里。Cloudflare 的「直接上传（拖拽上传压缩包）」不支持 Functions，
所以不能用「把 zip 拖到网页里」这种方式部署，否则页面能打开、接口全废。

必须用下面 方法A 或 方法B 之一来部署。

========================================================
方法 A：Git 集成（推荐，全程网页操作，不用命令行）
========================================================
1. 上传代码到 GitHub：
   - 登录 github.com，点右上角 "+" → New repository，随便起个名（如 auth-demo），
     Public 或 Private 都行，点 Create repository。
   - 进入仓库页，点 "uploading an existing file"（或 Add file → Upload files）。
   - 把本文件夹里的内容（public、functions、wrangler.toml、package.json、
     package-lock.json、db、README.txt 共 7 项，全部拖进上传区，
     不要拖 auth-demo 文件夹本身），点 Commit changes。

2. 在 Cloudflare 里连仓库：
   - 登录 dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git。
   - 选 GitHub → 授权 → 选刚才的仓库 → Begin setup。
   - 构建设置：
       Framework preset      ：None（或无框架）
       Build command         ：留空（本项目无需构建）
       Build output directory：public
   - 点 Save and Deploy，等它部署完，会得到一个网址（xxx.pages.dev）。

3. 做完上面，继续做「部署后三件套」（见下方）。

========================================================
方法 B：命令行（wrangler）
========================================================
在本机项目目录里执行：
    npm install
    npx wrangler login                 # 会弹出浏览器让你授权
    npx wrangler d1 create auth-demo   # 记下返回的 database_id
    npx wrangler pages deploy public --project-name auth-demo --d1=DB=<database_id>

部署完同样要做「部署后三件套」。

========================================================
部署后三件套（无论 A 还是 B，缺一不可）
========================================================
① 建 D1 数据库
   Cloudflare 左侧菜单 → D1 SQL database → Create database → 名称 auth-demo。

② 绑定 D1 + 设环境变量
   Pages 项目 → Settings：
   - Bindings → Add binding → 类型 D1 database → Variable name 填 "DB" → 选 auth-demo。
   - Environment variables → Add variable（Production 环境）：
       DEV_MODE          = 0
       INIT_TOKEN        = （你自己编一串随机字符，例如 init-2026-xK9mQ7vT4zL8）
       BREVO_API_KEY     = （从你本地 .dev.vars 复制，xkeysib- 开头）
       MAIL_FROM         = stylex666666@gmail.com
       MAIL_FROM_NAME    = 授权平台

   注意：DEV_MODE 一定要设成 0（本地是 1，线上必须改成 0，
   否则验证码会被直接回显到接口响应里，等于绕过验证）。

③ 重新部署（让上面的绑定和变量生效）
   Pages 项目 → Deployments → 最新那条部署 → 右边的 ⋯ → Retry deployment。

④ 初始化数据库（建表）
   浏览器打开（把域名和 INIT_TOKEN 换成你自己的）：
     https://你的项目.pages.dev/api/admin/init?token=你的INIT_TOKEN
   看到 {"ok":true,...} 就成功，还会送一个演示账号 demo_user / Demo123456。

========================================================
验证是否成功
========================================================
打开你的 https://xxx.pages.dev 首页：
  - 能正常加载注册/登录页
  - 用邮箱注册一个账号，能收到验证码邮件（Brevo 发出）
  - 用密码登录正常
以上都通过，就说明部署完全成功。

========================================================
常见问题
========================================================
1. 页面能开，但注册/登录报错 → 九成是 D1 没绑定 或 没做第④步建表。
2. 注册收不到验证码 → 检查 BREVO_API_KEY / MAIL_FROM 是否在 Production 环境设了。
3. 所有接口 500 → 检查 D1 绑定名是否拼成 "DB"（大小写敏感）。
4. 想改版本/续费/看设备 → 登录后进控制台页面即可，功能都在里面。 
