# Code adapted from https://github.com/miguelgrinberg/react-flask-app/blob/main/Dockerfile.combo
# and https://blog.miguelgrinberg.com/post/how-to-dockerize-a-react-flask-project
# Build step #1: build the React front end
FROM node:16-alpine as build-step
WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH
COPY ./ebook2quiz/package.json ./ebook2quiz/yarn.lock ./
COPY ./ebook2quiz/src ./src
COPY ./ebook2quiz/public ./public
RUN yarn install
RUN yarn build

# Build step #2: build API with client as static files
FROM python:3.10
WORKDIR /app
COPY --from=build-step /app/build ./build

RUN mkdir ./api
COPY api/requirements.txt api/app.py ./ api/lm_quiz_generation.py ./ api/parse_hrefs.py ./api/
RUN pip install -r ./api/requirements.txt
ENV FLASK_ENV production

RUN mkdir ./api/logs

EXPOSE 3000
WORKDIR /app/api
# 500 seconds timeout for gunicorn (since sometimes the href parsing or LLM generation takes a while)
CMD ["gunicorn", "-b", ":3000", "-t", "500", "app:app"]