FROM node:18-bullseye-slim

WORKDIR /app

# Git install kar rahe hain kyunki npm packages ko iski zaroorat hai
RUN apt-get update && apt-get install -y git

COPY package*.json ./

RUN npm install

COPY . .

# Back4App container default port
EXPOSE 8080
ENV PORT=8080

CMD ["npm", "start"]
