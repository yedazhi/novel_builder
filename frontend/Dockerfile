# 前端开发环境Dockerfile
FROM node:24.3.0

# 设置工作目录
WORKDIR /app

# 设置yarn镜像源
RUN yarn config set registry https://registry.npmmirror.com

# 复制package.json和yarn.lock
COPY package.json ./

# 使用yarn安装依赖
RUN yarn install
# 复制源代码
COPY . .

# 暴露端口
EXPOSE 5173

# 启动开发服务器
CMD ["yarn", "dev", "--host", "0.0.0.0"]