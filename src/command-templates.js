export const COMMAND_TEMPLATES = [
  {
    id: "openclaw-gateway",
    name: "OpenClaw Gateway",
    group: "ai-proxy",
    command: "openclaw",
    args: "gateway start",
    cwd: "",
    envText: "OPENCLAW_TOKEN=",
    description: {
      "zh-CN": "快速创建 OpenClaw 网关启动命令。",
      "en-US": "Quickly create an OpenClaw gateway command."
    }
  },
  {
    id: "cli-proxy-api",
    name: "CLI Proxy API",
    group: "ai-proxy",
    command: "cli-proxy-api.exe",
    args: "",
    cwd: "",
    envText: "",
    description: {
      "zh-CN": "适合本地代理可执行文件。",
      "en-US": "Good for a local proxy executable."
    }
  },
  {
    id: "npm-dev",
    name: "npm dev server",
    group: "dev",
    command: "npm",
    args: "run dev",
    cwd: "",
    envText: "NODE_ENV=development",
    description: {
      "zh-CN": "前端或 Node 开发服务的常用模板。",
      "en-US": "Common template for frontend or Node dev servers."
    }
  },
  {
    id: "python-service",
    name: "Python Service",
    group: "services",
    command: "python",
    args: "app.py",
    cwd: "",
    envText: "PYTHONUNBUFFERED=1",
    description: {
      "zh-CN": "适合长期驻留的 Python 脚本或 API。",
      "en-US": "Useful for long-running Python scripts or APIs."
    }
  }
];
