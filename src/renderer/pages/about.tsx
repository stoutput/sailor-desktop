import React from 'react'

const About = () => {
    return (
        <div>
            Sailor Desktop Version: v1.0.0
            <br/>
            Docker Engine Version:
            <br/>
            Docker Compose Version: {window.config.DOCKER_COMPOSE_VERSION}
            <br/>
            <br/>
            <h2>Credits:</h2>
            <br/>
            Many thanks to:
            <br/>
            Colima and their open-source tooling around Lima Docker integration
            <br/>
            <a href="https://github.com/apocas/dockerode">Dockerode</a>
            <br/>
            Docker
            <br/>
            <br/>
            Icons thanks to:
            <br/>
            Donate here:
        </div>
    );
}

export default About