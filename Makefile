.DEFAULT_GOAL := bootstrap

bootstrap:
	asdf install
	npm i --also-dev
	make dl-bin

dl-bin:
	python -m tools.dl-bin