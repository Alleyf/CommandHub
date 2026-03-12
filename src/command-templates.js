export const COMMAND_TEMPLATES = [
  {
    "id": "node-dev",
    "name": "Node.js Dev",
    "group": "node",
    "command": "npm",
    "args": "run dev",
    "cwd": "",
    "envText": "NODE_ENV=development",
    "description": {
      "zh-CN": "Node.js开发服务器",
      "en-US": "Node.js dev server"
    }
  },
  {
    "id": "node-start",
    "name": "Node.js Start",
    "group": "node",
    "command": "node",
    "args": "index.js",
    "cwd": "",
    "envText": "NODE_ENV=development",
    "description": {
      "zh-CN": "Node.js启动入口",
      "en-US": "Node.js main entry"
    }
  },
  {
    "id": "python-flask",
    "name": "Flask Server",
    "group": "python",
    "command": "python",
    "args": "-m flask run",
    "cwd": "",
    "envText": "FLASK_APP=app.py\nFLASK_ENV=development",
    "description": {
      "zh-CN": "Flask开发服务器",
      "en-US": "Flask dev server"
    }
  },
  {
    "id": "python-fastapi",
    "name": "FastAPI",
    "group": "python",
    "command": "uvicorn",
    "args": "main:app --reload",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "FastAPI开发服务器",
      "en-US": "FastAPI dev server"
    }
  },
  {
    "id": "python-django",
    "name": "Django",
    "group": "python",
    "command": "python",
    "args": "manage.py runserver",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Django开发服务器",
      "en-US": "Django dev server"
    }
  },
  {
    "id": "java-spring",
    "name": "Spring Boot",
    "group": "java",
    "command": "./mvnw",
    "args": "spring-boot:run",
    "cwd": "",
    "envText": "SPRING_PROFILES_ACTIVE=dev",
    "description": {
      "zh-CN": "Spring Boot启动",
      "en-US": "Spring Boot startup"
    }
  },
  {
    "id": "go-run",
    "name": "Go Run",
    "group": "go",
    "command": "go",
    "args": "run .",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Go运行",
      "en-US": "Go run main"
    }
  },
  {
    "id": "rust-run",
    "name": "Cargo Run",
    "group": "rust",
    "command": "cargo",
    "args": "run",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Cargo运行",
      "en-US": "Cargo run"
    }
  },
  {
    "id": "docker-up",
    "name": "Docker Compose Up",
    "group": "docker",
    "command": "docker-compose",
    "args": "up -d",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Docker Compose启动",
      "en-US": "Docker Compose up"
    }
  },
  {
    "id": "docker-dev",
    "name": "Docker Dev",
    "group": "docker",
    "command": "docker-compose",
    "args": "up -d --build",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Docker开发模式",
      "en-US": "Docker dev mode"
    }
  },
  {
    "id": "vite-dev",
    "name": "Vite Dev",
    "group": "frontend",
    "command": "npm",
    "args": "run dev",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Vite开发服务器",
      "en-US": "Vite dev server"
    }
  },
  {
    "id": "next-dev",
    "name": "Next.js Dev",
    "group": "frontend",
    "command": "npm",
    "args": "run dev",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Next.js开发服务器",
      "en-US": "Next.js dev server"
    }
  },
  {
    "id": "mysql",
    "name": "MySQL",
    "group": "database",
    "command": "docker",
    "args": "run -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=root mysql:latest",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "MySQL容器",
      "en-US": "MySQL container"
    }
  },
  {
    "id": "redis",
    "name": "Redis",
    "group": "database",
    "command": "docker",
    "args": "run -d -p 6379:6379 redis:alpine",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "Redis容器",
      "en-US": "Redis container"
    }
  },
  {
    "id": "postgres",
    "name": "PostgreSQL",
    "group": "database",
    "command": "docker",
    "args": "run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:latest",
    "cwd": "",
    "envText": "",
    "description": {
      "zh-CN": "PostgreSQL容器",
      "en-US": "PostgreSQL container"
    }
  }
]