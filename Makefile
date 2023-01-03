.DEFAULT_GOAL := bootstrap

bootstrap:
	asdf install
	npm i --also-dev

dl-bin:
	python -m tools.dl-bin