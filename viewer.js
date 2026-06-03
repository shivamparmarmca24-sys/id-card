import * as THREE from 'https://cdn.jsdelivr.net/npm/three@r128/build/three.module.js';
import { STLLoader } from 'https://cdn.jsdelivr.net/npm/three@r128/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@r128/examples/jsm/controls/OrbitControls.js';

class STLViewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.gridMesh = null;
        this.sliceLines = [];
        this.worker = null;
        this.geometryData = null;
        this.bounds = { min: new THREE.Vector3(), max: new THREE.Vector3() };
        
        this.init();
        this.setupEventListeners();
        this.initWorker();
    }

    init() {
        const canvas = document.getElementById('canvas');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
        
        this.camera = new THREE.PerspectiveCamera(
            75,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            10000
        );
        this.camera.position.set(0, 0, 150);
        
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.autoRotate = false;
        this.controls.zoomSpeed = 2;
        
        this.setupLighting();
        this.setupGrid();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -200;
        directionalLight.shadow.camera.right = 200;
        directionalLight.shadow.camera.top = 200;
        directionalLight.shadow.camera.bottom = -200;
        this.scene.add(directionalLight);
        
        const pointLight = new THREE.PointLight(0x64b5f6, 0.4);
        pointLight.position.set(-50, 50, 50);
        this.scene.add(pointLight);
    }

    setupGrid() {
        const gridHelper = new THREE.GridHelper(200, 20, 0x404060, 0x2a2a3e);
        gridHelper.position.z = 0;
        this.scene.add(gridHelper);
        
        const planeGeometry = new THREE.PlaneGeometry(200, 200);
        const planeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x1a1a2e,
            metalness: 0.3,
            roughness: 0.7
        });
        const planeZ = new THREE.Mesh(planeGeometry, planeMaterial);
        planeZ.receiveShadow = true;
        planeZ.rotateX(-Math.PI / 2);
        this.scene.add(planeZ);
        
        const axesHelper = new THREE.AxesHelper(50);
        this.scene.add(axesHelper);
    }

    setupEventListeners() {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const sliceButton = document.getElementById('sliceButton');
        
        dropZone.addEventListener('click', () => fileInput.click());
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('active');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('active');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('active');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadSTL(files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadSTL(e.target.files[0]);
            }
        });
        
        sliceButton.addEventListener('click', () => this.performSlicing());
    }

    initWorker() {
        this.worker = new Worker('slicerWorker.js');
        this.worker.onmessage = (e) => this.handleWorkerMessage(e.data);
    }

    loadSTL(file) {
        this.updateStatus('Loading...', false);
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const geometry = this.parseSTL(e.target.result);
                geometry.computeBoundingBox();
                geometry.computeVertexNormals();
                
                if (this.model) {
                    this.scene.remove(this.model);
                }
                
                const material = new THREE.MeshPhongMaterial({
                    color: 0x64b5f6,
                    emissive: 0x111111,
                    shininess: 200,
                    flatShading: false
                });
                
                this.model = new THREE.Mesh(geometry, material);
                this.model.castShadow = true;
                this.model.receiveShadow = true;
                
                this.centerModel();
                this.scene.add(this.model);
                
                this.geometryData = {
                    positions: Array.from(geometry.attributes.position.array),
                    index: geometry.index ? Array.from(geometry.index.array) : null,
                    bounds: {
                        min: geometry.boundingBox.min,
                        max: geometry.boundingBox.max
                    }
                };
                
                this.updateModelStats(geometry);
                this.updateStatus('Model loaded', true);
                document.getElementById('sliceButton').disabled = false;
                
            } catch (error) {
                this.updateStatus('Error loading file', false);
                console.error(error);
            }
        };
        
        reader.readAsArrayBuffer(file);
    }

    parseSTL(arrayBuffer) {
        const view = new Uint8Array(arrayBuffer);
        const isASCII = this.isASCIISTL(arrayBuffer);
        
        if (isASCII) {
            return this.parseASCIISTL(new TextDecoder().decode(arrayBuffer));
        } else {
            return this.parseBinarySTL(arrayBuffer);
        }
    }

    isASCIISTL(arrayBuffer) {
        const view = new Uint8Array(arrayBuffer);
        const header = new TextDecoder().decode(view.slice(0, 5));
        return header.toLowerCase() === 'solid';
    }

    parseBinarySTL(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const triangles = view.getUint32(80, true);
        const positions = [];
        const normals = [];
        
        let offset = 84;
        for (let i = 0; i < triangles; i++) {
            const nx = view.getFloat32(offset, true);
            const ny = view.getFloat32(offset + 4, true);
            const nz = view.getFloat32(offset + 8, true);
            offset += 12;
            
            for (let j = 0; j < 3; j++) {
                positions.push(view.getFloat32(offset, true));
                offset += 4;
                positions.push(view.getFloat32(offset, true));
                offset += 4;
                positions.push(view.getFloat32(offset, true));
                offset += 4;
                
                normals.push(nx, ny, nz);
            }
            
            offset += 2;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        
        return geometry;
    }

    parseASCIISTL(data) {
        const positions = [];
        const normals = [];
        
        const normalPattern = /normal\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;
        const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;
        
        let normalMatch;
        let currentNormal = [0, 0, 1];
        
        while ((normalMatch = normalPattern.exec(data)) !== null) {
            currentNormal = [parseFloat(normalMatch[1]), parseFloat(normalMatch[3]), parseFloat(normalMatch[5])];
        }
        
        let vertexMatch;
        while ((vertexMatch = vertexPattern.exec(data)) !== null) {
            positions.push(parseFloat(vertexMatch[1]));
            positions.push(parseFloat(vertexMatch[3]));
            positions.push(parseFloat(vertexMatch[5]));
            normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        
        return geometry;
    }

    centerModel() {
        const box = new THREE.Box3().setFromObject(this.model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        this.model.position.sub(center);
        this.model.position.z = -box.min.z;
        
        this.bounds = { min: box.min, max: box.max };
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        
        cameraZ *= 1.5;
        this.camera.position.z = cameraZ;
        this.controls.target.copy(new THREE.Vector3(0, 0, size.z / 2));
        this.controls.update();
    }

    updateModelStats(geometry) {
        const box = geometry.boundingBox;
        const size = box.getSize(new THREE.Vector3());
        const triangles = geometry.attributes.position.array.length / 9;
        
        document.getElementById('triangleCount').textContent = Math.floor(triangles).toLocaleString();
        document.getElementById('vertexCount').textContent = (geometry.attributes.position.array.length / 3).toLocaleString();
        document.getElementById('sizeX').textContent = size.x.toFixed(2);
        document.getElementById('sizeY').textContent = size.y.toFixed(2);
        document.getElementById('sizeZ').textContent = size.z.toFixed(2);
        
        document.getElementById('modelSection').style.display = 'flex';
    }

    performSlicing() {
        if (!this.geometryData) return;
        
        const layerHeight = parseFloat(document.getElementById('layerHeight').value);
        const zOffset = parseFloat(document.getElementById('zOffset').value);
        
        document.getElementById('slicingSection').style.display = 'flex';
        document.getElementById('sliceButton').disabled = true;
        
        this.clearSliceVisualization();
        
        this.worker.postMessage({
            positions: this.geometryData.positions,
            index: this.geometryData.index,
            layerHeight: layerHeight,
            zOffset: zOffset,
            bounds: this.geometryData.bounds
        });
    }

    handleWorkerMessage(data) {
        if (data.type === 'progress') {
            const percentage = Math.round((data.current / data.total) * 100);
            document.getElementById('progressFill').style.width = percentage + '%';
            document.getElementById('progressText').textContent = percentage + '%';
        }
        
        if (data.type === 'complete') {
            this.visualizeSlices(data.layers);
            this.displayLayerData(data.layers);
            document.getElementById('sliceButton').disabled = false;
            this.updateStatus('Slicing complete', true);
        }
        
        if (data.type === 'error') {
            console.error('Worker error:', data.message);
            document.getElementById('sliceButton').disabled = false;
            this.updateStatus('Slicing failed', false);
        }
    }

    visualizeSlices(layers) {
        this.clearSliceVisualization();
        
        const layerCount = layers.length;
        
        layers.forEach((layer, index) => {
            const hue = (index / layerCount) * 0.6;
            const color = new THREE.Color().setHSL(hue, 1, 0.5);
            
            layer.perimeters.forEach(perimeter => {
                const points = [];
                for (let i = 0; i < perimeter.length; i += 2) {
                    points.push(new THREE.Vector3(perimeter[i], perimeter[i + 1], layer.z));
                }
                
                if (points.length > 0) {
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const material = new THREE.LineBasicMaterial({ 
                        color: color,
                        linewidth: 1,
                        transparent: true,
                        opacity: 0.7
                    });
                    const line = new THREE.Line(geometry, material);
                    this.scene.add(line);
                    this.sliceLines.push(line);
                }
            });
        });
    }

    clearSliceVisualization() {
        this.sliceLines.forEach(line => {
            line.geometry.dispose();
            line.material.dispose();
            this.scene.remove(line);
        });
        this.sliceLines = [];
    }

    displayLayerData(layers) {
        const preview = document.getElementById('layerPreview');
        preview.innerHTML = '';
        
        layers.slice(0, 50).forEach((layer, index) => {
            const layerDiv = document.createElement('div');
            const segmentCount = layer.perimeters.reduce((sum, p) => sum + (p.length / 2), 0);
            layerDiv.textContent = `Layer ${index}: Z=${layer.z.toFixed(2)}mm, Segments=${Math.round(segmentCount)}`;
            preview.appendChild(layerDiv);
        });
        
        if (layers.length > 50) {
            const moreDiv = document.createElement('div');
            moreDiv.textContent = `... and ${layers.length - 50} more layers`;
            moreDiv.style.color = '#808080';
            preview.appendChild(moreDiv);
        }
        
        document.getElementById('layerSection').style.display = 'flex';
    }

    updateStatus(text, isReady) {
        const indicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        
        statusText.textContent = text;
        if (isReady) {
            indicator.classList.add('ready');
        } else {
            indicator.classList.remove('ready');
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        const canvas = this.renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new STLViewer();
});