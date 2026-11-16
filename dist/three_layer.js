export class ThreeLayer {
    canvas;
    renderer;
    scene;
    camera;
    pool = [];
    n = 0;
    texs = new Map();
    blank;
    /** 本帧提交的贴图片数（调试/测试用） */ quads = 0;
    static available() { return typeof globalThis.THREE !== 'undefined' && !!globalThis.THREE.WebGLRenderer; }
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setClearColor(0x1c2a22, 1);
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 10);
        this.camera.position.z = 5;
        const c = document.createElement('canvas');
        c.width = c.height = 2;
        this.blank = this.tex(c);
    }
    resize(W, H, dpr) {
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(W, H, false);
        this.camera.left = 0;
        this.camera.right = W;
        this.camera.top = 0;
        this.camera.bottom = -H;
        this.camera.updateProjectionMatrix();
    }
    /** 每个图片/画布对应一张纹理，只上传一次；逐帧变化的画布用 touch() 标记重传 */
    tex(src) {
        let t = this.texs.get(src);
        if (!t) {
            t = new THREE.Texture(src);
            t.generateMipmaps = false;
            t.minFilter = THREE.LinearFilter;
            t.magFilter = THREE.LinearFilter; // 非 2 的幂尺寸在 WebGL1 上也能用
            t.needsUpdate = true;
            this.texs.set(src, t);
        }
        return t;
    }
    touch(src) { this.tex(src).needsUpdate = true; }
    drop(src) { const t = this.texs.get(src); if (t) {
        t.dispose();
        this.texs.delete(src);
    } }
    begin() { this.n = 0; }
    /** 提交一张贴图片。x,y,w,h 为屏幕上的矩形（CSS 像素，左上角起）；u0,u1 为横向取样范围（帧带取帧；u0>u1 即水平翻转） */
    quad(src, x, y, w, h, u0 = 0, u1 = 1, alpha = 1) {
        let m = this.pool[this.n];
        if (!m) {
            const geo = new THREE.PlaneGeometry(1, 1);
            const mat = new THREE.MeshBasicMaterial({ map: this.blank, transparent: true, depthTest: false, depthWrite: false });
            m = new THREE.Mesh(geo, mat);
            m.frustumCulled = false;
            this.scene.add(m);
            this.pool[this.n] = m;
        }
        m.material.map = this.tex(src);
        m.material.opacity = alpha;
        m.position.set(x + w / 2, -(y + h / 2), 0);
        m.scale.set(w, h, 1);
        // PlaneGeometry 的四个顶点：左上、右上、左下、右下
        const uv = m.geometry.attributes.uv;
        if (uv.getX(0) !== u0 || uv.getX(1) !== u1) {
            uv.setXY(0, u0, 1);
            uv.setXY(1, u1, 1);
            uv.setXY(2, u0, 0);
            uv.setXY(3, u1, 0);
            uv.needsUpdate = true;
        }
        m.renderOrder = this.n;
        m.visible = true;
        this.n++;
    }
    end() {
        for (let i = this.n; i < this.pool.length; i++)
            this.pool[i].visible = false;
        this.quads = this.n;
        this.renderer.render(this.scene, this.camera);
    }
}
