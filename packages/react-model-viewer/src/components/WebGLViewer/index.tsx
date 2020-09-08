/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
import * as S from '@m-fe/utils';
import TextSprite from '@seregpie/three.text-sprite';
import each from 'lodash/each';
import max from 'lodash/max';
import UZIP from 'pako';
import React from 'react';
import Loader from 'react-loader-spinner';
import * as THREE from 'three';

import {
  IModelViewerProps,
  ModelAttr,
  ModelCompressType,
  ModelType,
  defaultModelViewerProps
} from '../../types';
import { getFileObjFromModelSrc, getModelCompressType, getModelType } from '../../utils/file';
import { calcTopology } from '../../utils/mesh';
import { canTransformToGLTF, transformToGLTF } from '../../utils/GLTF';
import { Holdable } from '../Holdable';
import { Switch } from '../Switch';

import './index.css';

// import { OrbitControls } from 'three-orbitcontrols-ts';
const OrbitControls = require('three-orbit-controls')(THREE);
// import { ViewerControl, ViewerControlConfig } from './ViewerControl';

const fudge = 1.0;

interface IProps extends IModelViewerProps {}

interface IState {
  type: ModelType;
  compressType: ModelCompressType;
  topology?: ModelAttr;
  modelFile?: File;

  cameraX?: number;
  cameraY?: number;
  cameraZ?: number;

  loaded: boolean;

  // 是否展示信息
  withAttr: boolean;
  // 是否展示线框图
  withWireframe?: boolean;
  // 是否展示底平面
  withPlane?: boolean;
  // 是否展示标尺线
  withBoundingBox?: boolean;
  // 是否展示球体
  withSphere?: boolean;
  // 是否展示坐标系
  withAxis?: boolean;
  // 是否渲染
  withMaterial?: boolean;
}

export class WebGLViewer extends React.Component<IProps, IState> {
  id = S.genId();
  static defaultProps = { ...defaultModelViewerProps };

  $ref = React.createRef<HTMLDivElement>();

  state: IState = {
    type: this.props.type || getModelType(this.props.fileName, this.props.src),
    compressType:
      this.props.compressType || getModelCompressType(this.props.fileName, this.props.src),
    loaded: false,
    cameraX: 0,
    cameraY: 0,
    cameraZ: 0,
    withMaterial: true,
    withAttr: this.props.withAttr,
    withPlane: true,
    withAxis: true
  };

  model?: THREE.Mesh;
  modelWireframe?: THREE.Mesh;

  animationId: number;
  scene: THREE.Scene;
  group: THREE.Group;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  // controls: ViewerControl;
  orbitControls: any;
  boundingBox: THREE.BoxHelper;
  xSprite: any;
  ySprite: any;
  zSprite: any;
  plane: THREE.GridHelper;

  xDims: number;
  yDims: number;
  zDims: number;

  componentDidMount() {
    this.loadModel(this.props);
  }

  componentWillReceiveProps(nextProps: IProps) {
    if (nextProps.src !== this.props.src) {
      this.loadModel(nextProps);
    }
  }

  /** 这里根据传入的文件类型，进行不同的文件转化 */
  async loadModel(props: IProps) {
    const modelFile = await getFileObjFromModelSrc({
      ...props,
      type: 'stl',
      compressType: this.state.compressType
    });

    await this.setState({ modelFile });
    // 判断是否有 onZip，有的话则进行压缩并且返回
    requestAnimationFrame(async () => {
      this.handleZip();
    });

    // 判断是否可以进行预览，不可以预览则仅设置
    if (!canTransformToGLTF(this.state.type)) {
      return;
    }

    try {
      // 进行模型实际加载
      const { mesh } = await transformToGLTF(
        modelFile || props.src,
        this.state.type,
        this.props.onError
      );

      this.initGeometry(mesh.geometry);
    } catch (e) {
      console.error(e);
    }
  }

  /** 初始化几何体 */
  initGeometry(geometry: THREE.BufferGeometry | THREE.Geometry) {
    this._setupScene();
    this._setupRenderer();
    this._setupLights();

    geometry.computeBoundingSphere();
    geometry.center();

    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

    const material = new THREE.MeshPhongMaterial({
      color: this.props.modelColor,
      specular: 0x111111,
      shininess: 20
    });
    const mesh = new THREE.Mesh(geometry, material);

    geometry.computeBoundingBox();
    this.xDims = geometry.boundingBox.max.x - geometry.boundingBox.min.x;
    this.yDims = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
    this.zDims = geometry.boundingBox.max.z - geometry.boundingBox.min.z;

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = material;

    // reset center point
    const box = new THREE.Box3().setFromObject(mesh);
    box.getCenter(mesh.position);
    mesh.position.multiplyScalar(-1);

    this.model = mesh;

    if (this.state.withMaterial) {
      this.group.add(this.model);
    }

    this.scene.updateMatrixWorld();

    this._setupControls();
    this._setupDecorators();

    requestAnimationFrame(time => {
      this.animate(time);
      // 已加载完毕
      this.setState({ loaded: true }, () => {
        this.onLoad();
      });
    });
  }

  /** 清除实体 */
  destroy() {
    cancelAnimationFrame(this.animationId);

    if (this.scene !== null) {
      each(this.group.children, object => {
        this.group.remove(object);
      });

      each(this.scene.children, object => {
        this.scene.remove(object);
      });
    }

    this.scene = null;
    this.group = null;
    this.model = null;
    this.modelWireframe = null;
    this.boundingBox = null;

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.$ref.current.remove();
  }

  /** 初始化场景 */
  _setupScene() {
    const scene = new THREE.Scene();
    const group = new THREE.Group();

    this.scene = scene;
    this.group = group;

    this.scene.add(this.group);
  }

  get $dom() {
    return this.$ref.current || document.getElementById('webgl-container');
  }
  /** 初始化渲染器 */
  _setupRenderer() {
    const { backgroundColor } = this.props;

    if (!this.$dom) {
      return;
    }

    const height = this.$dom.clientHeight;
    const width = this.$dom.clientWidth;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const devicePixelRatio = window.devicePixelRatio || 1;

    renderer.setClearColor(new THREE.Color(backgroundColor), 1);
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(width, height);

    // renderer.gammaInput = true;
    // renderer.gammaOutput = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.cullFace = THREE.CullFaceBack;

    this.$dom.appendChild(renderer.domElement);

    this.renderer = renderer;
  }

  /** 初始化灯光 */
  _setupLights() {
    // Ambient
    this.scene.add(new THREE.AmbientLight(0xcccccc));

    // Light 3
    const light = new THREE.SpotLight(0xcccccc);
    light.angle = 1.7;
    light.position.set(100, 500, 100);

    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    light.target = target;

    this.scene.add(light);
  }

  /** 初始化控制器 */
  _setupControls() {
    this._setupCamera();

    this.orbitControls = new OrbitControls(this.camera, this.$dom);
    this.orbitControls.enableKeys = false;
    this.orbitControls.enableZoom = true;
    this.orbitControls.enablePan = true;
    this.orbitControls.addEventListener('change', this.renderScene.bind(this));
  }

  _setupCamera() {
    if (!this.$dom) {
      return;
    }

    const height = this.$dom.clientHeight;
    const width = this.$dom.clientWidth;
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 99999);

    const { model } = this;

    this.camera = camera;

    if (model) {
      this._resetCamera();
    }
  }

  private _resetCamera() {
    const geometry = this.model.geometry;
    geometry.computeBoundingSphere();

    const g = this.model.geometry.boundingSphere.radius;
    const dist = g * 3;

    // fudge factor so you can see the boundaries
    this.camera.position.set(
      this.props.cameraX,
      this.props.cameraY,
      this.props.cameraZ || dist * fudge
    );
  }

  animate(_time: number) {
    this.animationId = requestAnimationFrame(time => {
      this.animate(time);
    });

    // if (this.controls) {
    //   this.controls.update(_time);
    // }

    this.renderScene();
  }

  renderScene() {
    // horizontal rotation
    if (!this.group) {
      return;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _setupDecorators() {
    const { withWireframe, withBoundingBox } = this.state;

    this._setupPlane();

    if (withWireframe) {
      this._setupModelWireframe();
    }

    if (withBoundingBox) {
      this._setupBoundingBox();
    }
  }

  _setupModelWireframe() {
    const { model } = this;
    if (!model) {
      return;
    }

    if (this.modelWireframe) {
      this.group.remove(this.modelWireframe);
    }

    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      specular: 0x111111,
      shininess: 20,
      wireframe: true
    });

    const mesh = this.model.clone();
    mesh.material = material;

    this.modelWireframe = mesh;
    this.group.add(mesh);
  }

  /** 设置包裹体 */
  private _setupBoundingBox() {
    if (this.model) {
      if (this.boundingBox && this.group) {
        this.group.remove(this.boundingBox);
      }

      const wireframe = new THREE.WireframeGeometry(this.model.geometry);
      const line = new THREE.LineSegments(wireframe);

      (line.material as THREE.Material).depthTest = false;
      (line.material as THREE.Material).opacity = 0.75;
      (line.material as THREE.Material).transparent = true;

      // reset center point
      const box = new THREE.Box3().setFromObject(line);
      box.getCenter(line.position);
      line.position.multiplyScalar(-1);

      this.boundingBox = new THREE.BoxHelper(line);

      this.group.add(this.boundingBox);

      line.updateMatrix();
      const lineBox = line.geometry.boundingBox;
      const lineBoxMaxVertex = lineBox.max;
      console.log(lineBoxMaxVertex);

      const { topology } = this.state;

      const genSprite = (len: number) =>
        new TextSprite({
          fillStyle: 'rgb(255, 153, 0)',
          fontSize: 2.5,
          fontStyle: 'italic',
          text: `${S.toFixedNumber(len, 2)} mm`
        });

      this.xSprite = genSprite(topology.sizeX);
      this.ySprite = genSprite(topology.sizeY);
      this.zSprite = genSprite(topology.sizeZ);

      this.xSprite.position.set(0, lineBoxMaxVertex.y, lineBoxMaxVertex.z);
      this.ySprite.position.set(lineBoxMaxVertex.x, 0, lineBoxMaxVertex.z);
      this.zSprite.position.set(lineBoxMaxVertex.x, lineBoxMaxVertex.y, 0);

      this.group.add(this.xSprite);
      this.group.add(this.ySprite);
      this.group.add(this.zSprite);
    }
  }

  /** 设置平面 */
  _setupPlane() {
    if (this.model) {
      if (this.plane) {
        this.group.remove(this.plane);
      }

      // Getmax dimention and add 10% overlap for plane
      // with a gutter of 10
      const geometry = this.model.geometry;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      let maxDimension = max([this.xDims, this.yDims, this.zDims]);
      maxDimension = Math.ceil(~~(maxDimension * 1.1) / 10) * 50;

      const plane = new THREE.GridHelper(maxDimension, 50);

      // reset center point
      const box = new THREE.Box3().setFromObject(plane);
      box.getCenter(plane.position);
      plane.position.multiplyScalar(-1);

      // plane.position.y = geometry.boundingSphere.center.y * -1;
      plane.position.y = this.yDims * -1;

      this.plane = plane;
      this.group.add(this.plane);
    }
  }

  onLoad = async () => {
    const { withAttr, onTopology, onLoad } = this.props;

    if (onLoad) {
      onLoad();
    }

    // 计算基础信息
    if ((onTopology || withAttr) && this.model) {
      const topology = await calcTopology(this.model);

      this.setState({ topology });

      if (onTopology) {
        onTopology(topology);
      }
    }
  };

  handleZip = async () => {
    const { src, onZip } = this.props;
    const { modelFile } = this.state;

    // 仅在传入了 Zipped 文件的情况下调用
    if (modelFile && onZip && src && this.state.compressType === 'none') {
      const buffer = await S.readFileAsArrayBufferAsync(modelFile);
      const intArray: Uint8Array = new Uint8Array(buffer);

      const zippedFile = UZIP.deflate(intArray);

      onZip(zippedFile);
    }
  };

  /** 响应着色图变化 */
  onMaterialChange = (selected = true) => {
    if (this.state.withMaterial === selected) {
      return;
    }

    this.setState({
      withMaterial: selected
    });

    if (selected) {
      this.group.add(this.model);
    } else {
      this.group.remove(this.model);
    }
  };

  /** 响应线框图的变化 */
  onWireframeChange = (selected = true) => {
    const { withWireframe } = this.state;

    if (withWireframe !== selected) {
      if (this.modelWireframe) {
        this.group.remove(this.modelWireframe);
        this.modelWireframe = null;
      }

      if (selected) {
        this._setupModelWireframe();
      }
    }

    this.setState({ withWireframe: selected });
  };

  /** 响应框体变化 */
  onBoundingBoxChange = (selected = true) => {
    if (this.state.withBoundingBox === selected) {
      return;
    }

    this.setState({
      withBoundingBox: selected
    });

    if (selected) {
      this._setupBoundingBox();
    } else {
      this.group.remove(this.boundingBox);
      this.group.remove(this.xSprite);
      this.group.remove(this.ySprite);
      this.group.remove(this.zSprite);
      this.boundingBox = null;
      this.xSprite = null;
      this.ySprite = null;
      this.zSprite = null;
    }
  };

  renderWebGL() {
    const { width, height, style } = this.props;

    const { loaded } = this.state;

    return (
      <div
        id="webgl-container"
        className="rmv-sv-webgl"
        ref={this.$ref}
        style={{ width, height, ...style }}
      >
        {!loaded && (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <Loader type="Puff" color="#00BFFF" height={100} width={100} />
          </div>
        )}
      </div>
    );
  }

  renderAttr() {
    const { externalAttr, fileName } = this.props;

    const { withAttr, topology } = this.state;

    return (
      withAttr &&
      topology && (
        <div className="rmv-gmv-attr-modal">
          {fileName && <div className="item">名称：{fileName}</div>}
          <div className="rmv-gmv-attr-modal-row">
            <div className="item">
              尺寸：{S.toFixedNumber(topology.sizeX)} * {S.toFixedNumber(topology.sizeY)} *{' '}
              {S.toFixedNumber(topology.sizeZ)} {' mm'}
            </div>
            <div className="item">
              体积：{S.toFixedNumber(topology.volume)}
              {' mm³'}
            </div>
            <div className="item">
              面积：{S.toFixedNumber(topology.area, 2)}
              {' mm²'}
            </div>
            <div className="item">面片：{topology.triangleCnt} 个</div>
            {Object.keys(externalAttr).map(k => (
              <div className="item" key={k}>
                {k}：{externalAttr[k]}
              </div>
            ))}
          </div>
        </div>
      )
    );
  }

  renderLoose() {
    const { width, withJoystick } = this.props;

    const { withMaterial, withWireframe, withBoundingBox, withAttr, topology } = this.state;

    return (
      <div className="rmv-sv-container rmv-sv-loose-container" style={{ width }}>
        <div className="rmv-sv-toolbar">
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withMaterial-${this.id}`}>着色：</label>
            <Switch
              id={`withMaterial-${this.id}`}
              checked={withMaterial}
              onChange={e => {
                this.onMaterialChange(e.target.checked);
              }}
            />
          </div>
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withWireframe-${this.id}`}>线框：</label>
            <Switch
              id={`withWireframe-${this.id}`}
              checked={withWireframe}
              onChange={e => {
                this.onWireframeChange(e.target.checked);
              }}
            />
          </div>
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withBoundingBox-${this.id}`}>框体：</label>
            <Switch
              id={`withBoundingBox-${this.id}`}
              checked={withBoundingBox}
              onChange={e => {
                this.onBoundingBoxChange(e.target.checked);
              }}
            />
          </div>
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withAttr-${this.id}`}>信息：</label>
            <Switch
              id={`withAttr-${this.id}`}
              checked={withAttr}
              onChange={e => {
                this.setState({ withAttr: e.target.checked });
              }}
            />
          </div>
          {withJoystick && (
            <div className="rmv-sv-joystick">
              <div
                className="rmv-sv-joystick-center"
                onClick={() => {
                  this._resetCamera();
                }}
              />
              <Holdable
                finite={false}
                onPress={() => {
                  this.camera && this.camera.translateY(-topology.sizeY / 10);
                }}
              >
                <div
                  className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-up"
                  style={{ top: 0 }}
                >
                  <i />
                </div>
              </Holdable>
              <Holdable
                finite={false}
                onPress={() => {
                  this.camera && this.camera.translateY(topology.sizeY / 10);
                }}
              >
                <div
                  className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-down"
                  style={{ bottom: 0 }}
                >
                  <i />
                </div>
              </Holdable>
              <Holdable
                finite={false}
                onPress={() => {
                  this.camera && this.camera.translateX(-topology.sizeX / 10);
                }}
              >
                <div className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-left">
                  <i />
                </div>
              </Holdable>
              <Holdable
                finite={false}
                onPress={() => {
                  this.camera && this.camera.translateX(topology.sizeX / 10);
                }}
              >
                <div className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-right">
                  <i />
                </div>
              </Holdable>
            </div>
          )}
        </div>
        {this.renderAttr()}

        {this.renderWebGL()}
      </div>
    );
  }

  render() {
    const { width, height, style, layoutType, withJoystick } = this.props;

    const { withMaterial, withWireframe, withBoundingBox, withAttr, topology, type } = this.state;

    if (!canTransformToGLTF(type)) {
      return (
        <div
          className="rmv-sv-container"
          style={{ width, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          <div
            className="rmv-sv-webgl"
            ref={this.$ref}
            style={{
              width,
              height,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              ...style
            }}
          >
            该类型暂不支持预览！
          </div>
        </div>
      );
    }

    if (layoutType === 'loose') {
      // 宽松方式
      return this.renderLoose();
    }

    return (
      <div className="rmv-sv-container" style={{ width }}>
        <div className="rmv-sv-toolbar">
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withMaterial-${this.id}`}>着色：</label>
            <input
              type="checkbox"
              name={`withMaterial-${this.id}`}
              checked={withMaterial}
              onChange={e => {
                this.onMaterialChange(e.target.checked);
              }}
            />
          </div>
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withWireframe-${this.id}`}>线框：</label>
            <input
              type="checkbox"
              name={`withWireframe-${this.id}`}
              checked={withWireframe}
              onChange={e => {
                this.onWireframeChange(e.target.checked);
              }}
            />
          </div>
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withBoundingBox-${this.id}`}>框体：</label>
            <input
              type="checkbox"
              name={`withBoundingBox-${this.id}`}
              checked={withBoundingBox}
              onChange={e => {
                this.onBoundingBoxChange(e.target.checked);
              }}
            />
          </div>
          <div className="rmv-sv-toolbar-item">
            <label htmlFor={`withAttr-${this.id}`}>信息：</label>
            <input
              type="checkbox"
              name={`withAttr-${this.id}`}
              checked={withAttr}
              onChange={e => {
                this.setState({ withAttr: e.target.checked });
              }}
            />
          </div>
        </div>
        {this.renderAttr()}
        {withJoystick && (
          <>
            <Holdable
              finite={false}
              onPress={() => {
                this.camera.translateY(-topology.sizeY / 10);
              }}
            >
              <div
                className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-up"
                style={{ top: 40 }}
              >
                <i />
              </div>
            </Holdable>
            <Holdable
              finite={false}
              onPress={() => {
                this.camera.translateY(topology.sizeY / 10);
              }}
            >
              <div className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-down">
                <i />
              </div>
            </Holdable>
            <Holdable
              finite={false}
              onPress={() => {
                if (this.camera) {
                  this.camera.translateX(-topology.sizeX / 10);
                }
              }}
            >
              <div className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-left">
                <i />
              </div>
            </Holdable>
            <Holdable
              finite={false}
              onPress={() => {
                if (this.camera) {
                  this.camera.translateX(topology.sizeX / 10);
                }
              }}
            >
              <div className="rmv-gmv-attr-joystick-arrow rmv-gmv-attr-joystick-arrow-right">
                <i />
              </div>
            </Holdable>
          </>
        )}
        {this.renderWebGL()}
      </div>
    );
  }
}
