ARG ES_VERSION=9.4.3
FROM docker.elastic.co/elasticsearch/elasticsearch:${ES_VERSION}
# 한국어 형태소 분석기
RUN bin/elasticsearch-plugin install --batch analysis-nori
