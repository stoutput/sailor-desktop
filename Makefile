.DEFAULT_GOAL := bootstrap

bootstrap:
	asdf install
	npm i --also-dev