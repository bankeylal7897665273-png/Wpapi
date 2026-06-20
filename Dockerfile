FROM node:18-bullseye-slim

WORKDIR /app

# Git install kar rahe hain kyunki npm packages ko iski zaroorat hai
RUN apt-get update && apt-get install -y git

COPY package*.json ./

RUN npm install

COPY . .

# Hugging Face Spaces default port
EXPOSE 7860

CMD ["npm", "start"]

