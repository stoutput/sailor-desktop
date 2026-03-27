.DEFAULT_GOAL := bootstrap

bootstrap:
	asdf install
	npm i --also-dev
	python3 -m venv tools/.venv
	source tools/.venv/bin/activate
	tools/.venv/bin/pip install -r tools/requirements.txt

run:
	npm start

dl-bin:
	python -m tools.dl-bin