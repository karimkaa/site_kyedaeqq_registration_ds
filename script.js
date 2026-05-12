import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const API_URL = 'http://127.0.0.1:5000';
let currentUserEmail = null;


document.addEventListener('DOMContentLoaded', () => {


    if (typeof THREE === 'undefined') { console.error('Three.js not loaded'); return; }

    // ─── Renderer ─────────────────────────────────────────────────────────────
    const canvas = document.getElementById('particleCanvas');
    const W = window.innerWidth, H = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true, 
        alpha: false,
        powerPreference: 'high-performance'
    });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1.5 : 1);
    renderer.setClearColor(0x00000a);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = false;

    // Dynamic Quality
    function setQuality(isLow) {
        if (isLow) {
            renderer.setPixelRatio(0.6);
        } else {
            renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1.5 : 1);
        }
    }

    const scene  = new THREE.Scene();
    // Camera Setup
    const camera = new THREE.PerspectiveCamera(25, W / H, 0.1, 5000);
    camera.position.set(0, 0.3, 4.0);
    camera.lookAt(0, 0, 0);

    // Optimization Helpers
    const _v1 = new THREE.Vector3();
    const _v2 = new THREE.Vector3();
    const _v3 = new THREE.Vector3();

    // ─── Sun direction ────────────────────────────────────────────────────────
    // Sun in front-right of camera so the Earth face towards us is LIT
    const SUN = new THREE.Vector3(0.4, 0.5, 1.0).normalize();

    // ─── Texture loader helper ────────────────────────────────────────────────
    const texLoader = new THREE.TextureLoader();
    function loadTex(path) {
        const t = texLoader.load(path);
        t.anisotropy     = renderer.capabilities.getMaxAnisotropy();
        t.minFilter      = THREE.LinearMipmapLinearFilter;
        t.magFilter      = THREE.LinearFilter;
        t.generateMipmaps = true;
        return t;
    }

    // ─── 8K day texture from the FBX model pack ───────────────────────────────
    const earthTex8K = loadTex('./models/textures/1_earth_8k.jpg');

    // ─── Night lights (fallback from our textures folder) ────────────────────
    const nightTex   = loadTex('./textures/earth-night.jpg');
    const cloudTex   = loadTex('./textures/earth-clouds.png');
    const waterTex   = loadTex('./textures/earth-water.png');
    const topoTex    = loadTex('./textures/earth-topology.png');

    // ─── Custom PBR ShaderMaterial (applied to FBX geometry) ─────────────────
    const earthMat = new THREE.ShaderMaterial({
        uniforms: {
            dayMap:   { value: earthTex8K },
            nightMap: { value: nightTex   },
            cloudMap: { value: cloudTex   },
            waterMap: { value: waterTex   },
            topoMap:  { value: topoTex    },
            sunDir:   { value: SUN        },
            camPos:   { value: camera.position.clone() }
        },
        vertexShader: `
            varying vec2 vUV;
            varying vec3 vNorm;
            varying vec3 vWorld;
            void main(){
                vUV   = uv;
                vNorm = normalize(normalMatrix * normal);
                vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;

            uniform sampler2D dayMap, nightMap, cloudMap, waterMap, topoMap;
            uniform vec3 sunDir, camPos;

            varying vec2 vUV;
            varying vec3 vNorm, vWorld;

            // ACESFilmic tone mapping
            vec3 ACESFilmic(vec3 x){
                return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
            }

            // GGX microfacet specular
            float GGX(vec3 N, vec3 H, float rough){
                float a  = rough * rough;
                float a2 = a * a;
                float NdH   = max(0.0, dot(N, H));
                float denom = NdH*NdH*(a2-1.0)+1.0;
                return a2 / (3.14159265 * denom * denom + 0.0001);
            }

            // Schlick Fresnel
            float Fresnel(vec3 V, vec3 N, float F0){
                float c = 1.0 - max(0.0, dot(V, N));
                return F0 + (1.0-F0)*c*c*c*c*c;
            }

            void main(){
                vec3 viewDir = normalize(camPos - vWorld);

                // 8-tap Sobel bump from elevation map
                vec2 ts = vec2(1.0/8192.0, 1.0/4096.0);
                float hTL=texture2D(topoMap,vUV+vec2(-ts.x, ts.y)).r;
                float hT =texture2D(topoMap,vUV+vec2(  0.0, ts.y)).r;
                float hTR=texture2D(topoMap,vUV+vec2( ts.x, ts.y)).r;
                float hL =texture2D(topoMap,vUV+vec2(-ts.x,  0.0)).r;
                float hR =texture2D(topoMap,vUV+vec2( ts.x,  0.0)).r;
                float hBL=texture2D(topoMap,vUV+vec2(-ts.x,-ts.y)).r;
                float hB =texture2D(topoMap,vUV+vec2(  0.0,-ts.y)).r;
                float hBR=texture2D(topoMap,vUV+vec2( ts.x,-ts.y)).r;
                float dX = -hTL-2.0*hL-hBL + hTR+2.0*hR+hBR;
                float dY = -hTL-2.0*hT-hTR + hBL+2.0*hB+hBR;
                vec3 N   = normalize(vNorm + vec3(dX, dY, 0.0) * 1.6);

                // Lighting
                float NdotL = dot(N, sunDir);
                float diff   = max(0.0, NdotL);
                float dayMix = smoothstep(-0.15, 0.28, NdotL);

                // 8K day texture — sRGB to linear
                vec3 day = texture2D(dayMap, vUV).rgb;
                day = pow(day, vec3(2.2));
                // Vibrance
                float lum = dot(day, vec3(0.299, 0.587, 0.114));
                day = mix(vec3(lum), day, 1.35);

                // Clouds & water
                float cld   = texture2D(cloudMap, vUV).r;
                float water = texture2D(waterMap, vUV).r;

                // Day illumination — boosted ambient + diffuse
                vec3 dayCol = day * (0.08 + diff * 1.20);

                // Cloud shadow
                float cldShadow = texture2D(cloudMap, vUV + sunDir.xy * 0.007).r;
                dayCol *= 1.0 - cldShadow * 0.45 * diff;

                // GGX ocean specular + Fresnel
                vec3  halfV  = normalize(sunDir + viewDir);
                float spec   = GGX(N, halfV, 0.07);
                float fres   = Fresnel(viewDir, halfV, 0.04);
                dayCol += vec3(0.90, 0.96, 1.00) * spec * fres * water * diff * 0.35;

                // Cloud layer
                dayCol = mix(dayCol, vec3(1.00,0.995,0.98)*(0.04+diff*1.10), cld*0.90);

                // Night city lights
                vec3 nightCol = texture2D(nightMap, vUV).rgb;
                nightCol = pow(nightCol, vec3(2.2));
                nightCol *= 5.0 * (1.0 - cld * 0.7);

                // Blend day / night
                vec3 col = mix(nightCol, dayCol, dayMix);

                // Terminator glow
                col += vec3(1.0, 0.50, 0.12) * exp(-NdotL*NdotL*50.0) * 0.55;
                col += vec3(0.10,0.30, 0.80) * exp(-NdotL*NdotL*200.0)* 0.14;

                // Rayleigh rim scatter
                float cosV = max(0.0, dot(vNorm, viewDir));
                float rim  = pow(1.0 - cosV, 3.5);
                col += vec3(0.15, 0.40, 1.00) * rim * max(0.0, dot(vNorm, sunDir)) * 0.25;

                // Tone mapping + gamma out
                col = ACESFilmic(col * 1.05);
                col = pow(col, vec3(1.0/2.2));

                gl_FragColor = vec4(col, 1.0);
            }
        `
    });

    // ─── FBX Loader ───────────────────────────────────────────────────────────
    let earthGroup = null;
    let clouds     = null;

    const fbxLoader = new FBXLoader();
    fbxLoader.load(
            './models/source/Earth.fbx',
            (fbx) => {
                // Apply our 8K texture to all meshes using MeshStandardMaterial
                fbx.traverse(child => {
                    if (child.isMesh) {
                        const stdMat = new THREE.MeshStandardMaterial({
                            map:         earthTex8K,
                            roughness:   0.65,
                            metalness:   0.0,
                            envMapIntensity: 0.5
                        });
                        
                        // Night cities shader setup
                        stdMat.onBeforeCompile = (shader) => {
                            shader.uniforms.tNight = { value: nightTex };
                            shader.uniforms.tClouds = { value: cloudTex };
                            shader.uniforms.sunDirView = { value: new THREE.Vector3() };
                            stdMat.userData.shader = shader; // Store for animate()

                            // Pass UVs
                            shader.vertexShader = `
                                varying vec2 vMyUv;
                                ${shader.vertexShader}
                            `;
                            shader.vertexShader = shader.vertexShader.replace(
                                '#include <uv_vertex>',
                                `
                                #include <uv_vertex>
                                vMyUv = uv;
                                `
                            );

                            shader.fragmentShader = `
                                uniform sampler2D tNight;
                                uniform sampler2D tClouds;
                                uniform vec3 sunDirView;
                                varying vec2 vMyUv;
                                ${shader.fragmentShader}
                            `;
                            shader.fragmentShader = shader.fragmentShader.replace(
                                '#include <dithering_fragment>',
                                `
                                #include <dithering_fragment>
                                // Day/night mix
                                float intensity = dot(vNormal, sunDirView);
                                float nightMix = smoothstep(0.0, -0.2, intensity);
                                
                                // Read city map
                                vec3 nightCol = texture2D(tNight, vMyUv).rgb;
                                float cld = texture2D(tClouds, vMyUv).r;
                                
                                // Boost lights
                                nightCol = pow(nightCol, vec3(2.2)) * 15.0 * (1.0 - cld * 0.8);
                                
                                // Apply night lights
                                gl_FragColor.rgb += nightCol * nightMix;
                                `
                            );
                        };

                        child.material = stdMat;
                        child.castShadow    = true;
                        child.receiveShadow = true;
                        
                        // Store meshes for animation
                        if (!window.earthCityMeshes) window.earthCityMeshes = [];
                        window.earthCityMeshes.push(child);
                    }
                });

                // Auto-scale to radius ≈ 1
                const box  = new THREE.Box3().setFromObject(fbx);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                fbx.scale.setScalar(2.0 / maxDim); // diameter = 2 → radius = 1

                // Center
                const center = new THREE.Vector3();
                box.getCenter(center);
                fbx.position.sub(center.multiplyScalar(2.0 / maxDim));

                earthGroup = fbx;
                scene.add(fbx);

                // Reposition camera — show Earth as a globe from orbit
                camera.position.set(0, 0.3, 4.0);
                camera.lookAt(0, 0, 0);

                // Rotate to show Eurasia/Africa by default
                fbx.rotation.y = Math.PI * 0.6;

                // Add atmosphere & clouds after FBX is ready
                addAtmosphere();
                addClouds();
                addHurricanes();
                addStars();
                addMoon();

                // Smooth loader fade out
                const loader = document.getElementById('pageLoader');
                if (loader) {
                    // 3s timeout
                    loader.style.opacity = '0';
                    setTimeout(() => loader.remove(), 3000);
                    
                    // Delay UI
                    setTimeout(() => {
                        const containerUI = document.querySelector('.container');
                        if (containerUI) containerUI.classList.remove('initial-hide');
                    }, 1200);
                }

                console.log('Earth FBX loaded successfully');
            },
            (xhr) => {
                const pct = Math.round(xhr.loaded / xhr.total * 100);
                console.log(`Loading FBX: ${pct}%`);
            },
            (err) => {
                console.error('FBX load error:', err);
                buildFallbackEarth();
            }
        );

    // ─── Fallback: plain SphereGeometry if FBX fails ─────────────────────────
    function buildFallbackEarth() {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 512, 512),
            new THREE.MeshStandardMaterial({ map: earthTex8K, roughness: 0.65, metalness: 0.0 })
        );
        earthGroup = new THREE.Group();
        earthGroup.add(sphere);
        scene.add(earthGroup);
        camera.position.set(0, 0.3, 2.8);
        camera.lookAt(0, 0, 0);
        addAtmosphere();
        addClouds();
        addStars();
        addMoon();
    }

    // ─── Moon Loader ──────────────────────────────────────────────────────────
    let moonPivot = new THREE.Group();
    scene.add(moonPivot);
    
    function addMoon() {
        const moonTex = loadTex('./moon/Textures/Diffuse_2K.png');
        const moonBump = loadTex('./moon/Textures/Bump_2K.png');
        
        fbxLoader.load(
            './moon/Moon 2K.fbx',
            (fbx) => {
                fbx.traverse(child => {
                    if (child.isMesh) {
                        child.material = new THREE.MeshStandardMaterial({
                            map: moonTex,
                            bumpMap: moonBump,
                            bumpScale: 0.005,
                            roughness: 0.9,
                            metalness: 0.0
                        });
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                // Auto-scale to Moon's relative size (Moon radius is ~0.2724 of Earth)
                const box  = new THREE.Box3().setFromObject(fbx);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const moonRadius = 0.2724; 
                fbx.scale.setScalar((2.0 / maxDim) * moonRadius);

                // Center
                const center = new THREE.Vector3();
                box.getCenter(center);
                fbx.position.sub(center.multiplyScalar((2.0 / maxDim) * moonRadius));

                const moonGroup = new THREE.Group();
                moonGroup.add(fbx);
                
                // Moon position
                moonGroup.position.set(2.5, 0.2, -0.5);
                moonPivot.add(moonGroup);
                
                // Tilt the moon orbit slightly (around 5.14 degrees)
                moonPivot.rotation.z = 5.14 * Math.PI / 180;

                console.log('Moon FBX loaded successfully');
            },
            undefined,
            (err) => console.error('Moon FBX load error:', err)
        );
    }

    // ─── Cloud shell ──────────────────────────────────────────────────────────
    let clouds1 = null, clouds2 = null;
    function addClouds() {
        const cloudMat = new THREE.MeshPhongMaterial({
            map: cloudTex,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        const cloudGeo = new THREE.SphereGeometry(1, 32, 32);
        clouds1 = new THREE.Mesh(cloudGeo, cloudMat);
        clouds1.scale.setScalar(1.006);
        
        clouds2 = new THREE.Mesh(cloudGeo, cloudMat.clone());
        clouds2.scale.setScalar(1.012);
        
        // Clouds rotation
        clouds2.rotation.x = Math.PI / 4;
        clouds2.rotation.y = Math.PI / 2;

        scene.add(clouds1);
        scene.add(clouds2);
    }

    // ─── Night Lights ───────────────────────────────────
    

    // ─── Hurricanes ─────────────────────────────────────────
    const hurricanes = [];
    function addHurricanes() {
        const hurrGeo = new THREE.PlaneGeometry(0.25, 0.25);
        const hurrMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 },
                opacity: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float opacity;
                varying vec2 vUv;
                void main() {
                    vec2 uv = vUv - 0.5;
                    float dist = length(uv);
                    if (dist > 0.5) discard;
                    
                    float angle = atan(uv.y, uv.x);
                    // Cyclone spiral
                    float spiral = sin(12.0 * dist - angle * 3.0 - time * 6.0);
                    float alpha = smoothstep(0.5, 0.0, dist) * smoothstep(-1.0, 1.0, spiral);
                    
                    gl_FragColor = vec4(0.9, 0.95, 1.0, alpha * opacity);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        for (let i = 0; i < 5; i++) {
            const mesh = new THREE.Mesh(hurrGeo, hurrMat.clone());
            const pivot = new THREE.Group();
            
            // Distribute on sphere
            const phi = Math.acos( -1 + ( 2 * Math.random() ) );
            const theta = Math.sqrt( 7000 * Math.PI ) * phi;
            // Above clouds
            mesh.position.setFromSphericalCoords(1.018, phi, theta);
            mesh.lookAt(0,0,0);
            
            pivot.add(mesh);
            if (earthGroup) {
                earthGroup.add(pivot);
            } else {
                scene.add(pivot);
            }
            
            hurricanes.push({
                mesh: mesh,
                life: Math.random() * Math.PI * 2,
                speed: 0.002 + Math.random() * 0.002
            });
        }
    }

    // ─── Atmosphere (Smooth gradient halo) ────────────────────────────────────
    let atmMesh1 = null;
    function addAtmosphere() {
        const atmMat = new THREE.ShaderMaterial({
            uniforms: { sunDir: { value: SUN } },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main(){
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * vec4(vPosition, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 sunDir;
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main(){
                    vec3 viewDir = normalize(-vPosition);
                    float NdotV = max(dot(vNormal, viewDir), 0.0);
                    float rim = 1.0 - NdotV; 
                    
                    // Atmosphere rim
                    
                    float alpha = smoothstep(1.0, 0.6, rim);
                    alpha = pow(alpha, 2.0); 
                    
                    float sunDot = dot(vNormal, sunDir);
                    float sunMix = smoothstep(-0.2, 0.8, sunDot);
                    
                    // Atmosphere color
                    vec3 color = mix(vec3(0.02, 0.05, 0.15), vec3(0.2, 0.5, 1.0), sunMix);
                    
                    // Glow
                    float glow = smoothstep(0.2, 1.0, sunDot) * 0.15; 
                    color += vec3(0.1, 0.2, 0.4) * glow; 
                    
                    gl_FragColor = vec4(color, alpha * (sunMix * 0.65 + glow));
                }
            `,
            side: THREE.FrontSide,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });
        // 32x32 segments
        atmMesh1 = new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 32), atmMat);
        scene.add(atmMesh1);
    }

    // ─── Stars ────────────────────────────────────────────────────────────────
    function addStars() {
        const sv = [];
        const phases = [];
        for (let i = 0; i < 7000; i++) {
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            const r  = 80 + Math.random() * 30;
            sv.push(r*Math.sin(ph)*Math.cos(th), r*Math.cos(ph), r*Math.sin(ph)*Math.sin(th));
            phases.push(Math.random() * Math.PI * 2);
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
        sg.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
        // Stars shader
        const starsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0.0 }
            },
            vertexShader: `
                uniform float time;
                attribute float aPhase;
                varying float vAlpha;
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    // Smooth fade:
                    
                    
                    
                    float t = sin(time * 0.5 + aPhase); 
                    float twinkle = smoothstep(-0.5, 0.5, t); 
                    vAlpha = twinkle;
                    gl_PointSize = 120.0 / -mvPosition.z;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    // Soft circle
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    if (length(coord) > 0.5) discard;
                    gl_FragColor = vec4(0.85, 0.90, 1.0, vAlpha);
                }
            `,
            transparent: true,
            depthWrite: false
        });

        const points = new THREE.Points(sg, starsMaterial);
        points.name = 'stars';
        window.starsObj = points; // Cache reference
        scene.add(points);
    }

    // ─── Lighting ─────────────────────────────────────────────────────────────
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.copy(SUN).multiplyScalar(20);
    sunLight.castShadow = false; // Disable shadow
    sunLight.shadow.mapSize.width = 1024; // Optimization
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 50;
    sunLight.shadow.camera.left = -5;
    sunLight.shadow.camera.right = 5;
    sunLight.shadow.camera.top = 5;
    sunLight.shadow.camera.bottom = -5;
    sunLight.shadow.bias = -0.0005;

    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x112244, 2.0));

    // ─── Resize ───────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ─── Animation loop ──────────────────
    let running = true;
    let starsTime = 0;
    let sunAngle = 0.5;

    document.addEventListener('visibilitychange', () => { running = !document.hidden; });

    (function animate() {
        requestAnimationFrame(animate);
        if (!running) return;

        starsTime += 0.016;
        if (window.starsObj) {
            window.starsObj.material.uniforms.time.value = starsTime;
        }

        const earthRotationSpeed = 0.000050;

        if (earthGroup) earthGroup.rotation.y += earthRotationSpeed;
        if (clouds1) clouds1.rotation.y += earthRotationSpeed * 1.1;
        if (clouds2) clouds2.rotation.y += earthRotationSpeed * 1.4;
        
        if (moonPivot) moonPivot.rotation.y += earthRotationSpeed * 5.0; 

        hurricanes.forEach(h => {
            h.life += h.speed;
            h.mesh.material.uniforms.time.value = starsTime;
            h.mesh.material.uniforms.opacity.value = Math.max(0, Math.sin(h.life)) * 0.55;
        });

        // Optimized sun calculation
        sunAngle -= 0.0001;
        _v1.set(Math.sin(sunAngle), 0.3, Math.cos(sunAngle)).normalize();
        sunLight.position.copy(_v1).multiplyScalar(20);
        
        // View space sun direction
        _v2.copy(_v1).transformDirection(camera.matrixWorldInverse);

        if (atmMesh1) {
            atmMesh1.material.uniforms.sunDir.value.copy(_v2);
        }
        
        // Optimized mesh traversal
        if (window.earthCityMeshes) {
            for (let i = 0; i < window.earthCityMeshes.length; i++) {
                const child = window.earthCityMeshes[i];
                if (child.material && child.material.userData && child.material.userData.shader) {
                    child.material.userData.shader.uniforms.sunDirView.value.copy(_v2);
                }
            }
        }

        renderer.render(scene, camera);
    })();

    // ─── Idle UI Fade Out ─────────────────────────────────────────────────────
    let idleTimer = null;
    const containerUI = document.querySelector('.container');
    
    function resetIdleTimer() {
        if (!containerUI) return;
        if (containerUI.classList.contains('ui-idle')) {
            containerUI.classList.remove('ui-idle');
        }
        clearTimeout(idleTimer);
        // Hide UI after 20s
        idleTimer = setTimeout(() => {
            containerUI.classList.add('ui-idle');
        }, 20000); 
    }
    
    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    window.addEventListener('touchstart', resetIdleTimer);
    resetIdleTimer();

    // ═══════════════════════════════════════════════════════════════════════════
    //  App logic
    // ═══════════════════════════════════════════════════════════════════════════
    const loginSection    = document.getElementById('loginSection');
    const registerSection = document.getElementById('registerSection');
    const profileSection  = document.getElementById('profileSection');
    const forgotSection   = document.getElementById('forgotPasswordSection');
    const resetSection    = document.getElementById('resetPasswordSection');

    function showSection(section, title) {
        [loginSection, registerSection, profileSection, forgotSection, resetSection].forEach(s => s.classList.remove('active'));
        section.classList.add('active');
        document.title = title;
        clearMessages();
    }

    const regAvatarContainer = document.getElementById('regAvatarContainer');
    const regAvatarFile = document.getElementById('regAvatarFile');
    const regAvatarImage = document.getElementById('regAvatarImage');
    const regAvatarIcon = document.getElementById('regAvatarIcon');

    if (regAvatarContainer && regAvatarFile) {
        regAvatarContainer.addEventListener('click', () => regAvatarFile.click());

        regAvatarFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    regAvatarImage.src = event.target.result;
                    regAvatarImage.style.display = 'block';
                    regAvatarIcon.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        });
    }

    document.getElementById('showRegister').addEventListener('click', e => {
        e.preventDefault(); showSection(registerSection, 'Регистрация | Premium Project');
    });
    document.getElementById('showLogin').addEventListener('click', e => {
        e.preventDefault(); showSection(loginSection, 'Вход | Premium Project');
    });
    document.getElementById('showForgotPassword').addEventListener('click', e => {
        e.preventDefault(); showSection(forgotSection, 'Восстановление пароля | Premium Project');
    });
    document.getElementById('showLoginFromForgot').addEventListener('click', e => {
        e.preventDefault(); showSection(loginSection, 'Вход | Premium Project');
    });
    document.getElementById('showLoginFromReset').addEventListener('click', e => {
        e.preventDefault(); showSection(loginSection, 'Вход | Premium Project');
    });

    document.getElementById('btnLogout').addEventListener('click', () => {
        currentUserEmail = null;
        document.getElementById('profileForm').reset();
        document.getElementById('avatarPreview').innerHTML = '<span class="material-symbols-outlined">account_circle</span>';
        showSection(loginSection, 'Вход | Premium Project');
        showMessage('Вы вышли из аккаунта', 'info');
    });

    function loadProfileUI(data) {
        currentUserEmail = data.email;
        document.getElementById('profileWelcome').textContent = `Привет, ${data.name}!`;
        if (data.avatar) {
            document.getElementById('profAvatar').value = data.avatar;
            document.getElementById('avatarPreview').innerHTML = `<img src="${data.avatar}" alt="Avatar">`;
        }
        if (data.phone) document.getElementById('profPhone').value = data.phone;
        if (data.bio)   document.getElementById('profBio').value   = data.bio;
        document.getElementById('profEmail').value = data.email || '';
        document.getElementById('profName').value = data.name || '';
        document.getElementById('profBirthdate').value = data.birthdate || '';
        
        // Enter messenger
        initAppInterface(data);
        
        showSection(profileSection, 'Ваш профиль | Premium Project');
    }

    // --- Avatar Logic ---
    const avatarContainer = document.getElementById('avatarContainer');
    const avatarMenu      = document.getElementById('avatarMenu');
    const btnViewPhoto    = document.getElementById('btnViewPhoto');
    const btnChangePhoto  = document.getElementById('btnChangePhoto');
    const profAvatarFile  = document.getElementById('profAvatarFile');
    const photoViewer     = document.getElementById('photoViewerModal');
    const cropperModal    = document.getElementById('cropperModal');
    let cropper = null;

    // Toggle menu
    avatarContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        avatarMenu.classList.toggle('active');
    });

    // Close menu
    document.addEventListener('click', () => avatarMenu.classList.remove('active'));

    // View photo
    btnViewPhoto.addEventListener('click', () => {
        const currentSrc = document.querySelector('#avatarPreview img')?.src;
        if (currentSrc) {
            document.getElementById('fullSizePhoto').src = currentSrc;
            photoViewer.classList.add('active');
        } else {
            showMessage('Фотография еще не установлена', 'info');
        }
    });

    // Change photo
    btnChangePhoto.addEventListener('click', () => profAvatarFile.click());

    // File selected
    profAvatarFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('imageToCrop').src = event.target.result;
            cropperModal.classList.add('active');
            
            if (cropper) cropper.destroy();
            
            // Init Cropper
            const image = document.getElementById('imageToCrop');
            cropper = new Cropper(image, {
                aspectRatio: 1,
                viewMode: 1,
                background: false
            });
        };
        reader.readAsDataURL(file);
    });

    // Save and upload crop
    document.getElementById('saveCrop').addEventListener('click', () => {
        if (!cropper) return;

        cropper.getCroppedCanvas({ width: 400, height: 400 }).toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('avatar', blob, 'avatar.jpg');

            cropperModal.classList.remove('active');
            showMessage('Загрузка аватарки…', 'info');

            try {
                const r = await fetch(`${API_URL}/upload_avatar`, { method: 'POST', body: formData });
                const d = await r.json();
                if (r.ok) {
                    document.getElementById('profAvatar').value = d.avatar_url;
                    document.getElementById('avatarPreview').innerHTML = `<img src="${d.avatar_url}" alt="Avatar">`;
                    showMessage('Аватарка обновлена!', 'success');
                } else {
                    showMessage(d.error || 'Ошибка загрузки', 'error');
                }
            } catch {
                showMessage('Ошибка сервера', 'error');
            }
        });
    });

    // Cancel crop
    document.getElementById('cancelCrop').addEventListener('click', () => {
        cropperModal.classList.remove('active');
        profAvatarFile.value = '';
    });

    // Close viewer
    photoViewer.addEventListener('click', () => photoViewer.classList.remove('active'));
    document.querySelector('.close-viewer').addEventListener('click', () => photoViewer.classList.remove('active'));

    // --- Messenger Logic ---
    const appInterface = document.getElementById('appInterface');
    const contactsList = document.getElementById('contactsList');
    const chatHistory  = document.getElementById('chatHistory');
    const chatInput    = document.getElementById('chatInput');
    const sendMsgBtn   = document.getElementById('sendMsgBtn');
    
    // Search Modal Elements
    const searchModal       = document.getElementById('searchModal');
    const openSearchBtn     = document.getElementById('openSearchBtn');
    const userSearchInput   = document.getElementById('userSearchInput');
    const userSearchResults = document.getElementById('userSearchResults');
    
    let currentRecipient = null;
    let chatPollInterval = null;
    let allUsersCache    = []; // For search

    async function initAppInterface(userData) {
        setQuality(true);
        const containerUI = document.querySelector('.container');
        if (containerUI) {
            containerUI.style.opacity = '0';
            containerUI.style.pointerEvents = 'none';
        }
        setTimeout(() => {
            appInterface.classList.add('active');
        }, 400);

        document.getElementById('miniName').textContent = userData.name;
        if (userData.avatar) {
            document.getElementById('miniAvatar').innerHTML = `<img src="${userData.avatar}">`;
        }
        
        fetchActiveContacts();
        fetchAllUsers(); // For search cache
    }

    async function fetchActiveContacts() {
        try {
            const r = await fetch(`${API_URL}/get_active_contacts?email=${currentUserEmail}`);
            const users = await r.json();
            if (r.ok) {
                renderActiveContacts(users);
            } else {
                console.error('Server error fetching contacts:', users.error);
                contactsList.innerHTML = '<div class="contacts-placeholder" style="color: #ef4444; text-align: center; margin-top: 50%;">Ошибка сервера</div>';
            }
        } catch (e) {
            console.error('Fetch active contacts error:', e);
            contactsList.innerHTML = '<div class="contacts-placeholder" style="color: #ef4444; text-align: center; margin-top: 50%;">Сетевая ошибка</div>';
        }
    }

    async function fetchAllUsers() {
        try {
            const r = await fetch(`${API_URL}/get_users`);
            const users = await r.json();
            if (r.ok) allUsersCache = users.filter(u => u.email !== currentUserEmail);
        } catch (e) { console.error('Fetch all users error:', e); }
    }

    function renderActiveContacts(users) {
        if (!users || users.length === 0) {
            contactsList.innerHTML = '<div class="contacts-placeholder" style="text-align: center; margin-top: 50%; opacity: 0.7;">Здесь ничего нет, попробуйте начать...</div>';
            return;
        }
        contactsList.innerHTML = users.map(u => {
            const safeAvatar = u.avatar ? u.avatar.replace(/"/g, '&quot;') : '';
            const safeName = u.name.replace(/"/g, '&quot;');
            return `
            <div class="contact-item" data-email="${u.email}" data-name="${safeName}" data-avatar="${safeAvatar}">
                <div class="contact-avatar">
                    ${u.avatar ? `<img src="${u.avatar}">` : '<span class="material-symbols-outlined">person</span>'}
                </div>
                <div class="contact-info">
                    <div class="contact-name">${u.name}</div>
                    <div class="contact-status">В сети</div>
                </div>
            </div>
        `}).join('');
    }

    contactsList.addEventListener('click', (e) => {
        const item = e.target.closest('.contact-item');
        if (!item) return;
        
        const email = item.getAttribute('data-email');
        const name = item.getAttribute('data-name');
        const avatar = item.getAttribute('data-avatar');
        
        window.selectChat(email, name, avatar);
    });

    // Search users
    openSearchBtn.addEventListener('click', () => {
        searchModal.classList.add('active');
        userSearchInput.focus();
    });

    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) searchModal.classList.remove('active');
    });

    userSearchInput.addEventListener('input', () => {
        const query = userSearchInput.value.toLowerCase().trim();
        if (!query) {
            userSearchResults.innerHTML = '';
            return;
        }
        
        const filtered = allUsersCache.filter(u => 
            u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)
        );
        
        renderSearchResults(filtered);
    });

    function renderSearchResults(users) {
        userSearchResults.innerHTML = users.map(u => {
            const safeAvatar = u.avatar ? u.avatar.replace(/"/g, '&quot;') : '';
            const safeName = u.name.replace(/"/g, '&quot;');
            return `
            <div class="search-result-item" data-email="${u.email}" data-name="${safeName}" data-avatar="${safeAvatar}" style="cursor: pointer;">
                <div class="search-result-avatar">
                    ${u.avatar ? `<img src="${u.avatar}">` : '<span class="material-symbols-outlined">person</span>'}
                </div>
                <div class="search-result-info">
                    <div class="search-result-name">${u.name}</div>
                    <div class="search-result-email">${u.email}</div>
                </div>
            </div>
        `}).join('');
    }

    userSearchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (!item) return;
        
        const email = item.getAttribute('data-email');
        const name = item.getAttribute('data-name');
        const avatar = item.getAttribute('data-avatar');
        
        searchModal.classList.remove('active');
        userSearchInput.value = '';
        userSearchResults.innerHTML = '';
        window.selectChat(email, name, avatar);
        fetchActiveContacts(); 
    });

    window.selectChatFromSearch = function(email, name, avatar) {
        searchModal.classList.remove('active');
        userSearchInput.value = '';
        userSearchResults.innerHTML = '';
        window.selectChat(email, name, avatar);
        
        // Update contacts sidebar
        fetchActiveContacts(); 
    };

    window.selectChat = function(email, name, avatar) {
        currentRecipient = email;
        document.getElementById('chatWelcome').style.display = 'none';
        document.getElementById('activeChat').style.display = 'flex';
        document.getElementById('activeName').textContent = name;
        document.getElementById('activeAvatar').innerHTML = avatar ? `<img src="${avatar}">` : '';

        chatHistory.innerHTML = '<div class="contacts-placeholder">Загрузка сообщений...</div>';
        fetchPrivateMessages();

        if (chatPollInterval) clearInterval(chatPollInterval);
        chatPollInterval = setInterval(fetchPrivateMessages, 2000);
        
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
            if (item.querySelector('.contact-name').textContent === name) item.classList.add('active');
        });
    };

    async function fetchPrivateMessages() {
        if (!currentRecipient) return;
        try {
            const r = await fetch(`${API_URL}/get_messages?sender_email=${currentUserEmail}&recipient_email=${currentRecipient}`);
            const msgs = await r.json();
            if (r.ok) {
                renderPrivateMessages(msgs);
            } else {
                console.error('Server error fetching msgs:', msgs.error);
                chatHistory.innerHTML = '<div class="contacts-placeholder" style="color: #ef4444;">Ошибка сервера: ' + (msgs.error || 'неизвестно') + '</div>';
            }
        } catch (e) {
            console.error('Fetch msgs error:', e);
            chatHistory.innerHTML = '<div class="contacts-placeholder" style="color: #ef4444;">Сетевая ошибка</div>';
        }
    }

    function renderPrivateMessages(msgs) {
        if (msgs.length === 0) {
            chatHistory.innerHTML = `
                <div class="empty-history-notice">
                    <span class="material-symbols-outlined">chat_bubble_outline</span>
                    <p>Чат пустой, начните общение!</p>
                </div>
            `;
            return;
        }

        chatHistory.innerHTML = msgs.map(m => {
            // Format time
            const date = new Date(m.time + 'Z');
            const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            return `
            <div class="message ${m.sender === currentUserEmail ? 'sent' : 'received'}">
                <span class="sender">${m.sender === currentUserEmail ? 'Вы' : ''}</span>
                ${m.text}
                <span class="timestamp" style="font-size: 0.7em; opacity: 0.7; margin-left: 8px; display: inline-block;">${timeStr}</span>
            </div>
        `}).join('');
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    async function sendPrivateMessage() {
        const text = chatInput.value.trim();
        if (!text || !currentRecipient) return;
        try {
            const r = await fetch(`${API_URL}/send_message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender_email: currentUserEmail, recipient_email: currentRecipient, text: text })
            });
            if (r.ok) {
                chatInput.value = '';
                fetchPrivateMessages();
                // Update sidebar on first message
                fetchActiveContacts(); 
            }
        } catch (e) { console.error('Send error:', e); }
    }

    sendMsgBtn.addEventListener('click', sendPrivateMessage);
    chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendPrivateMessage(); });
    document.getElementById('openSettings').addEventListener('click', () => {
        setQuality(false); // Reset quality
        appInterface.classList.remove('active');
        
        // Make sure container is visible and smooth
        const containerUI = document.querySelector('.container');
        if (containerUI) {
            containerUI.style.opacity = '1';
            containerUI.style.visibility = 'visible';
            containerUI.style.pointerEvents = 'auto';
        }
        
        showSection(profileSection, 'Настройки профиля | Premium Project');
    });

    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
        const containerUI = document.querySelector('.container');
        if (containerUI) {
            containerUI.style.opacity = '0';
            containerUI.style.pointerEvents = 'none';
        }
        setTimeout(() => {
            appInterface.classList.add('active');
        }, 400);
    });

    // --- Auth Forms Logic ---
    document.getElementById('registrationForm').addEventListener('submit', async e => {
        e.preventDefault();
        const name=document.getElementById('regName').value;
        const email=document.getElementById('regEmail').value;
        const password=document.getElementById('regPassword').value;
        const passwordConfirm=document.getElementById('regPasswordConfirm').value;
        const phone=document.getElementById('regPhone').value;
        const avatarFile=document.getElementById('regAvatarFile').files[0];
        const captchaResponse = window.grecaptcha ? grecaptcha.getResponse() : '';

        if (password !== passwordConfirm) {
            showMessage('Пароли не совпадают', 'error');
            return;
        }

        if (!captchaResponse) {
            showMessage('Пожалуйста, пройдите проверку на бота', 'error');
            return;
        }

        showMessage('Регистрация…', 'info');
        try {
            const r = await fetch(`${API_URL}/register`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password,captcha:captchaResponse})});
            const d = await r.json();
            if (r.ok) {
                let finalAvatarUrl = '';
                if (avatarFile) {
                    const formData = new FormData();
                    formData.append('avatar', avatarFile, 'avatar.jpg');
                    try {
                        const rAvatar = await fetch(`${API_URL}/upload_avatar`, { method: 'POST', body: formData });
                        const dAvatar = await rAvatar.json();
                        if (rAvatar.ok) finalAvatarUrl = dAvatar.avatar_url;
                    } catch(e) { console.error('Avatar upload failed', e); }
                }
                
                if (phone || finalAvatarUrl) {
                    await fetch(`${API_URL}/update_profile`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({email, avatar: finalAvatarUrl, phone, bio: ''})
                    });
                }

                showMessage('Успех!','success'); 
                document.getElementById('registrationForm').reset(); 
                setTimeout(()=>loadProfileUI({name:d.name,email:d.email,avatar:finalAvatarUrl,bio:'',phone}),1000); 
            }
            else { showMessage(d.error||'Ошибка','error'); if(window.grecaptcha) grecaptcha.reset(); }
        } catch (err) { showMessage('Ошибка сервера','error'); if(window.grecaptcha) grecaptcha.reset(); }
    });

    document.getElementById('loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        const email=document.getElementById('loginEmail').value, password=document.getElementById('loginPassword').value;
        showMessage('Вход…','info');
        try {
            const r = await fetch(`${API_URL}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
            const d = await r.json();
            if (r.ok) { showMessage(`Привет, ${d.name}!`,'success'); setTimeout(()=>loadProfileUI(d),500); }
            else showMessage(d.error||'Ошибка входа','error');
        } catch (err) { showMessage('Ошибка сервера','error'); }
    });

    let resetEmail = '';

    document.getElementById('forgotPasswordForm').addEventListener('submit', async e => {
        e.preventDefault();
        const email = document.getElementById('forgotEmail').value;
        showMessage('Отправка кода…', 'info');
        try {
            const r = await fetch(`${API_URL}/forgot_password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const d = await r.json();
            if (r.ok) {
                resetEmail = email;
                showMessage('Код отправлен на почту', 'success');
                setTimeout(() => showSection(resetSection, 'Новый пароль | Premium Project'), 1000);
            } else {
                showMessage(d.error || 'Ошибка', 'error');
            }
        } catch (err) { showMessage('Ошибка сервера', 'error'); }
    });

    document.getElementById('resetPasswordForm').addEventListener('submit', async e => {
        e.preventDefault();
        const code = document.getElementById('resetCode').value;
        const new_password = document.getElementById('resetNewPassword').value;
        showMessage('Смена пароля…', 'info');
        try {
            const r = await fetch(`${API_URL}/reset_password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: resetEmail, code, new_password })
            });
            const d = await r.json();
            if (r.ok) {
                showMessage('Пароль успешно изменен', 'success');
                setTimeout(() => showSection(loginSection, 'Вход | Premium Project'), 1000);
            } else {
                showMessage(d.error || 'Ошибка', 'error');
            }
        } catch (err) { showMessage('Ошибка сервера', 'error'); }
    });

    document.getElementById('profileForm').addEventListener('submit', async e => {
        e.preventDefault();
        const avatar=document.getElementById('profAvatar').value;
        const phone=document.getElementById('profPhone').value;
        const bio=document.getElementById('profBio').value;
        const name=document.getElementById('profName').value;
        const birthdate=document.getElementById('profBirthdate').value;
        const password=document.getElementById('profNewPassword').value;

        showMessage('Сохранение…','info');
        try {
            const r = await fetch(`${API_URL}/update_profile`,{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({email:currentUserEmail, avatar, phone, bio, name, birthdate, password})
            });
            if (r.ok) {
                showMessage('Сохранено!','success');
                // Update UI without reload
                document.getElementById('profileWelcome').textContent = `Привет, ${name}!`;
                document.getElementById('miniName').textContent = name;
                if (avatar) {
                    document.getElementById('miniAvatar').innerHTML = `<img src="${avatar}">`;
                }
                fetchActiveContacts(); // to update self in any relevant lists if needed
            } else {
                showMessage('Ошибка сохранения','error');
            }
        } catch (err) { showMessage('Ошибка сервера','error'); }
    });

    function resetChatState() {
        document.getElementById('activeChat').style.display = 'none';
        document.getElementById('chatWelcome').style.display = 'flex';
        document.getElementById('chatInput').value = '';
        document.getElementById('chatHistory').innerHTML = '';
        currentRecipient = null;
        if (chatPollInterval) {
            clearInterval(chatPollInterval);
            chatPollInterval = null;
        }
    }

    document.getElementById('btnLogout').addEventListener('click', () => {
        currentUserEmail = null;
        setQuality(false); // Reset quality
        document.getElementById('appInterface').classList.remove('active');
        profileSection.classList.remove('active');
        resetChatState();
        showSection(loginSection, 'Вход | Premium Project');
        showMessage('Вы вышли', 'info');
    });

    document.getElementById('miniLogout').addEventListener('click', () => {
        currentUserEmail = null;
        setQuality(false);
        document.getElementById('appInterface').classList.remove('active');
        
        const containerUI = document.querySelector('.container');
        if (containerUI) {
            containerUI.style.opacity = '1';
            containerUI.style.visibility = 'visible';
            containerUI.style.pointerEvents = 'auto';
        }
        
        resetChatState();
        showSection(loginSection, 'Вход | Premium Project');
        showMessage('Вы вышли из аккаунта', 'info');
    });


    window.openSocialAuth = function(provider) {
        const url=`${API_URL}/auth/${provider}/login`,w=500,h=600;
        window.open(url,'OAuth',`width=${w},height=${h},top=${(window.innerHeight-h)/2},left=${(window.innerWidth-w)/2}`);
    };

    window.addEventListener('message', event => {
        if (event.origin!==window.location.origin && event.origin!==API_URL) return;
        if (event.data && event.data.type==='OAUTH_SUCCESS') loadProfileUI(event.data.user);
    });

    const storedUser = localStorage.getItem('oauth_user');
    if (storedUser) {
        const d = JSON.parse(storedUser);
        localStorage.removeItem('oauth_user');
        loadProfileUI(d);
    }
});

function showMessage(text, type) {
    const s = document.getElementById('statusMessage');
    s.textContent = text;
    s.className = 'status-message show';
    if      (type === 'error')   s.classList.add('status-error');
    else if (type === 'success') s.classList.add('status-success');
    else {
        s.classList.add('status-success');
        s.style.background   = 'rgba(59,130,246,.1)';
        s.style.color        = '#93c5fd';
        s.style.borderColor  = 'rgba(59,130,246,.2)';
    }
}
function clearMessages() {
    const s = document.getElementById('statusMessage');
    s.className = 'status-message';
    s.textContent = '';
}
