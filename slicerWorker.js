self.onmessage = function(e) {
    const { positions, index, layerHeight, zOffset, bounds } = e.data;
    
    try {
        const layers = sliceMesh(positions, index, layerHeight, zOffset, bounds);
        
        self.postMessage({
            type: 'complete',
            layers: layers
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: error.message
        });
    }
};

function sliceMesh(positions, index, layerHeight, zOffset, bounds) {
    const minZ = bounds.min.z;
    const maxZ = bounds.max.z;
    
    const startZ = Math.ceil((minZ + zOffset) / layerHeight) * layerHeight;
    const endZ = Math.floor((maxZ + zOffset) / layerHeight) * layerHeight;
    
    const layers = [];
    const triangles = getTrianglesList(positions, index);
    const totalLayers = Math.max(1, Math.floor((endZ - startZ) / layerHeight) + 1);
    
    for (let layerIdx = 0; layerIdx <= totalLayers; layerIdx++) {
        const currentZ = startZ + layerIdx * layerHeight;
        
        if (currentZ > maxZ + zOffset + layerHeight) break;
        
        const perimeters = [];
        const segments = [];
        
        for (let triIdx = 0; triIdx < triangles.length; triIdx++) {
            const tri = triangles[triIdx];
            const intersections = getPlaneTriangleIntersection(tri, currentZ);
            
            if (intersections.length >= 2) {
                segments.push(...intersections);
            }
        }
        
        if (segments.length > 0) {
            const closed = connectSegments(segments);
            closed.forEach(perimeter => {
                perimeters.push(perimeter);
            });
            
            layers.push({
                z: currentZ,
                perimeters: perimeters
            });
        }
        
        const progress = Math.round((layerIdx / totalLayers) * 100);
        self.postMessage({
            type: 'progress',
            current: layerIdx,
            total: totalLayers
        });
    }
    
    return layers;
}

function getTrianglesList(positions, index) {
    const triangles = [];
    let posIdx = 0;
    
    if (index) {
        for (let i = 0; i < index.length; i += 3) {
            const i0 = index[i] * 3;
            const i1 = index[i + 1] * 3;
            const i2 = index[i + 2] * 3;
            
            const v0 = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
            const v1 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
            const v2 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];
            
            triangles.push([v0, v1, v2]);
        }
    } else {
        for (let i = 0; i < positions.length; i += 9) {
            const v0 = [positions[i], positions[i + 1], positions[i + 2]];
            const v1 = [positions[i + 3], positions[i + 4], positions[i + 5]];
            const v2 = [positions[i + 6], positions[i + 7], positions[i + 8]];
            
            triangles.push([v0, v1, v2]);
        }
    }
    
    return triangles;
}

function getPlaneTriangleIntersection(triangle, planeZ) {
    const [v0, v1, v2] = triangle;
    const intersections = [];
    
    const edges = [
        [v0, v1],
        [v1, v2],
        [v2, v0]
    ];
    
    for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx++) {
        const edge = edges[edgeIdx];
        const intersection = getPlaneLineIntersection(edge[0], edge[1], planeZ);
        
        if (intersection !== null) {
            intersections.push(intersection);
        }
    }
    
    if (intersections.length === 2) {
        return [intersections[0][0], intersections[0][1], intersections[1][0], intersections[1][1]];
    }
    
    return [];
}

function getPlaneLineIntersection(p1, p2, planeZ) {
    const z1 = p1[2];
    const z2 = p2[2];
    
    if ((z1 <= planeZ && z2 >= planeZ) || (z1 >= planeZ && z2 <= planeZ)) {
        if (Math.abs(z2 - z1) < 1e-10) {
            return [p1[0], p1[1]];
        }
        
        const t = (planeZ - z1) / (z2 - z1);
        const x = p1[0] + t * (p2[0] - p1[0]);
        const y = p1[1] + t * (p2[1] - p1[1]);
        
        return [x, y];
    }
    
    return null;
}

function connectSegments(segments) {
    if (segments.length === 0) return [];
    
    const perimeters = [];
    const used = new Set();
    
    for (let startIdx = 0; startIdx < segments.length; startIdx += 4) {
        if (used.has(startIdx)) continue;
        
        const perimeter = [];
        let currentIdx = startIdx;
        let lastX = segments[startIdx];
        let lastY = segments[startIdx + 1];
        
        perimeter.push(lastX, lastY);
        used.add(currentIdx);
        
        while (true) {
            let nextIdx = -1;
            let minDist = 0.1;
            
            for (let i = 0; i < segments.length; i += 4) {
                if (used.has(i)) continue;
                
                const dist = Math.hypot(
                    segments[i] - lastX,
                    segments[i + 1] - lastY
                );
                
                if (dist < minDist) {
                    minDist = dist;
                    nextIdx = i;
                }
            }
            
            if (nextIdx === -1) break;
            
            perimeter.push(segments[nextIdx + 2], segments[nextIdx + 3]);
            lastX = segments[nextIdx + 2];
            lastY = segments[nextIdx + 3];
            used.add(nextIdx);
            
            if (perimeter.length > 100000) break;
        }
        
        if (perimeter.length > 4) {
            perimeters.push(perimeter);
        }
    }
    
    return perimeters;
}