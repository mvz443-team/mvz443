import { PositionManager } from "../managers/view/PositionManager";
import { Game } from "../scenes/Game";
import DepthHelper from "../utils/helper/DepthHelper";

export interface ZombieAnimProps {
    Species: string, // 物种,如僵尸,骷髅等
    bodyKey: string, // 需要是两个,一个正常一个受伤
    headKey: string,
    armKey: string,
    legKey: string,
}

/**
 * 一般僵尸动画
 */
export default class IZombieAnim {
    scene: Game;
    scaneFactor: number;
    x: number;
    y: number;
    body: Phaser.GameObjects.Sprite;
    head: Phaser.GameObjects.Sprite;
    armLeft: Phaser.GameObjects.Sprite;
    armRight: Phaser.GameObjects.Sprite;
    legLeft: Phaser.GameObjects.Sprite;
    legRight: Phaser.GameObjects.Sprite;
    legLeftTween: Phaser.Tweens.Tween | null;
    legRightTween: Phaser.Tweens.Tween | null;
    armTween: Phaser.Tweens.Tween | null;

    species: string;

    // size
    // bodyWidth: number = 19;
    // bodyHeight: number = 35;
    headOffset: Array<number> = [-1, -46];
    leftArmOffset: Array<number> = [6, -24];
    rightArmOffset: Array<number> = [0, -26];
    leftLgetOffset: Array<number> = [2, -5];
    rightLegOffset: Array<number> = [-2, -10];


    // Effect
    private slowEffectTimer?: Phaser.Time.TimerEvent;

    setScale() {
        // 在创建完所有组件后进行全部组件的setScale
        console.log(this.scaneFactor)
        this.body.setScale(this.scaneFactor);
        this.head.setScale(this.scaneFactor);
        this.armLeft.setScale(this.scaneFactor);
        this.armRight.setScale(this.scaneFactor);
        this.legLeft.setScale(this.scaneFactor);
        this.legRight.setScale(this.scaneFactor);
    }

    constructor(scene: Game, x: number, y: number, props: ZombieAnimProps) {
        x = x;
        this.gridBottomY = y;
        y = y - PositionManager.Instance.GRID_SIZEY * 5 / 12;

        this.species = props.Species;
        this.scaneFactor = PositionManager.Instance.scaleFactor * 1.2;
        this.scene = scene;
        this.x = x;
        this.y = y;

        this.body = this.scene.add.sprite(x, y, props.bodyKey);
        this.body.setOrigin(0.5, 1);

        // TODO: 动画移动到全局
        this.scene.anims.create({
            key: `${this.species}bodyNormal`,
            frames: [{ key: props.bodyKey, frame: 0 }],
            frameRate: 1,
            repeat: 0
        });
        this.scene.anims.create({
            key: `${this.species}bodyInjured`,
            frames: [{ key: props.bodyKey, frame: 1 }],
            frameRate: 1,
            repeat: 0
        });
        this.body.anims.play(`${this.species}bodyNormal`);

        this.head = this.scene.add.sprite(x + this.headOffset[0] * this.scaneFactor,
            y + this.headOffset[1] * this.scaneFactor, props.headKey);
        this.armLeft = this.scene.add.sprite(x + this.leftArmOffset[0] * this.scaneFactor,
            y + this.leftArmOffset[1] * this.scaneFactor, props.armKey);
        this.armRight = this.scene.add.sprite(x + this.rightArmOffset[0] * this.scaneFactor,
            y + this.rightArmOffset[1] * this.scaneFactor, props.armKey);
        this.legLeft = this.scene.add.sprite(x + this.leftLgetOffset[0] * this.scaneFactor,
            y + this.leftLgetOffset[1] * this.scaneFactor, props.legKey);
        this.legRight = this.scene.add.sprite(x + this.rightLegOffset[0] * this.scaneFactor,
            y + this.rightLegOffset[1] * this.scaneFactor, props.legKey);

        this.armLeft.setOrigin(1, 0.5);
        this.armRight.setOrigin(1, 0.5);
        this.legLeft.setOrigin(0.5, 0);
        this.legRight.setOrigin(0.5, 0);

        this.setScale();

        this.legLeftTween = null;
        this.armTween = null;
    }

    setDepth(base: number) {
        // 部件不在本地管
        this.armLeft.setDepth(DepthHelper.Mob.legacyPart(base, "leftArm"));
        this.head.setDepth(DepthHelper.Mob.legacyPart(base, "head"));
        this.armRight.setDepth(DepthHelper.Mob.legacyPart(base, "rightArm"));
        this.body.setDepth(DepthHelper.Mob.legacyPart(base, "body"));
        this.legLeft.setDepth(DepthHelper.Mob.legacyPart(base, "leftLeg"));
        this.legRight.setDepth(DepthHelper.Mob.legacyPart(base, "rightLeg"));
    }

    private diving = false;
    private riding = false;
    /** 当前格子的底边 y（传入坐标尚未抬升为身体原点），潜水时据此定位头部。 */
    private gridBottomY = 0;

    /**
     * 头部挂点：潜水时落到当前格子底部中央，只露出头顶；常态跟随身体挂点。
     * x 用格子水平中心（不叠加 headOffset，保证"中部"），y 在格子底边上方留一点余量。
     */
    private placeHead(x: number, bodyY: number) {
        if (this.diving) {
            this.head.setPosition(x, this.gridBottomY - PositionManager.Instance.GRID_SIZEY * 0.12);
        } else {
            this.head.setPosition(
                x + this.headOffset[0] * this.scaneFactor,
                bodyY + this.headOffset[1] * this.scaneFactor,
            );
        }
    }

    /** 潜水姿态：只留头部（面罩由 Entity 绑定头部挂点），身体淡出；探出时反向淡入。 */
    setDivingPose(diving: boolean) {
        if (this.diving === diving) return;
        this.diving = diving;
        const bodyParts = [this.body, this.armLeft, this.armRight, this.legLeft, this.legRight];
        this.scene.tweens.killTweensOf(bodyParts);
        if (diving) {
            bodyParts.forEach((sprite) => { sprite.setVisible(false); sprite.setAlpha(1); });
            this.stopLegSwing();
        } else {
            bodyParts.forEach((sprite) => { sprite.setVisible(true); sprite.setAlpha(0); });
            this.scene.tweens.add({
                targets: bodyParts,
                alpha: { from: 0, to: 1 },
                duration: 260,
                ease: 'Sine.easeOut',
            });
        }
        this.head.setVisible(true);
        // 姿态切换立即把头部放到目标挂点，避免下一帧 updatePosition 前出现错位。
        this.placeHead(this.x, this.y);
    }

    /** 骑乘姿态：停腿摆，两腿固定 60°（向左顺时针 / 向右逆时针）；移动时 startLegSwing 跳过。 */
    setRidingPose(riding: boolean, facing: 1 | -1 = 1) {
        this.riding = riding;
        this.legLeftTween?.stop();
        this.legRightTween?.stop();
        const angle = riding ? 60 * facing : 0;
        this.legLeft.angle = angle;
        this.legRight.angle = angle;
    }

    startLegSwing() {
        if (this.riding) return;
        if (!this.legLeftTween || !this.legLeftTween.isPlaying()) {
            this.legLeft.angle = -15;
            this.legLeftTween = this.scene.tweens.add({
                targets: this.legLeft,
                angle: { from: -15, to: 15 },
                duration: 500,
                yoyo: true,
                repeat: -1
            });
            this.legRight.angle = 15;
            this.legRightTween = this.scene.tweens.add({
                targets: this.legRight,
                angle: { from: 15, to: -15 },
                duration: 500,
                yoyo: true,
                repeat: -1
            });
        }
    }

    stopLegSwing() {
        if (this.legLeftTween && this.legLeftTween.isPlaying()) {
            this.legLeftTween?.stop();
            this.legRightTween?.stop();
            this.legLeft.angle = 0;
            this.legRight.angle = 0;
        }
    }

    startArmSwing() {
        if (!this.armTween || !this.armTween.isPlaying()) {
            this.armTween = this.scene.tweens.add({
                targets: [this.armLeft, this.armRight],
                angle: { from: +15, to: -15 },
                duration: 500,
                yoyo: true,
                repeat: -1
            });
        }
    }

    startArmDance() {
        if (!this.armTween || !this.armTween.isPlaying()) {
            this.armTween = this.scene.tweens.add({
                targets: [this.armLeft, this.armRight],
                angle: { from: +105, to: +65 },
                duration: 500,
                yoyo: true,
                repeat: -1
            });
        }
    }

    stopArmSwing() {
        if (this.armTween && this.armTween.isPlaying()) {
            this.armTween.stop();
            this.armLeft.angle = 0;
            this.armRight.angle = 0;
        }
    }

    /**
     * @param isInjured 是否受伤
     */
    switchBodyFrame(isInjured: boolean) {
        if (isInjured) {
            this.body.anims.play(`${this.species}bodyInjured`);
        } else {
            this.body.anims.play(`${this.species}bodyNormal`);
        }
    }

    updatePosition(x: number, y: number) {
        x = x;
        this.gridBottomY = y;
        y = y - PositionManager.Instance.GRID_SIZEY * 25 / 54;
        this.x = x;
        this.y = y;
        this.body.setPosition(x, y);
        this.placeHead(x, y);
        this.armLeft.setPosition(x + this.leftArmOffset[0] * this.scaneFactor,
            y + this.leftArmOffset[1] * this.scaneFactor);
        this.armRight.setPosition(x + this.rightArmOffset[0] * this.scaneFactor,
            y + this.rightArmOffset[1] * this.scaneFactor);
        this.legLeft.setPosition(x + this.leftLgetOffset[0] * this.scaneFactor,
            y + this.leftLgetOffset[1] * this.scaneFactor);
        this.legRight.setPosition(x + this.rightLegOffset[0] * this.scaneFactor,
            y + this.rightLegOffset[1] * this.scaneFactor);
    }

    getHandAnchor() {
        const arm = this.armRight;
        const reach = arm.displayWidth;
        const rad = Phaser.Math.DegToRad(arm.angle);

        return {
            x: arm.x - Math.cos(rad) * reach,
            y: arm.y - Math.sin(rad) * reach,
        };
    }

    setOrigin(x: number, y: number) {
        this.body.setOrigin(x, y);
        this.head.setOrigin(x, y);
        this.armLeft.setOrigin(x, 0); // Keep top pivot for arms
        this.armRight.setOrigin(x, 0);
        this.legLeft.setOrigin(x, 0); // Keep top pivot for legs
        this.legRight.setOrigin(x, 0);
    }

    twinkle() {
        // Array of all components to twinkle
        const components = [
            this.body,
            this.head,
            this.armLeft,
            this.armRight,
            this.legLeft,
            this.legRight
        ];

        // Create a tween to make components twinkle
        this.scene.tweens.add({
            targets: components,
            alpha: { from: 1, to: 0.7 }, // Fade between fully visible and partially transparent
            duration: 300, // Duration of one fade
            yoyo: true, // Go back and forth
            repeat: -1, // Repeat indefinitely
            ease: 'Sine.easeInOut' // Smooth easing function
        });
    }

    highlight() {
        // 计算绘制效果所需参数
        const depth = DepthHelper.Mob.bodyText(this.body.depth);
        const centerX = this.x;
        // 因为僵尸的 body 原点为 (0.5, 1)，这里将中心点向上偏移一半的 GRID_SIZEY
        const centerY = this.y - PositionManager.Instance.GRID_SIZEY / 2;

        const rangeWidth = PositionManager.Instance.GRID_SIZEX;   // 横向范围
        const rangeHeight = PositionManager.Instance.GRID_SIZEY;    // 纵向范围
        const textSize = PositionManager.Instance.GRID_SIZEX / 5;    // 字体大小
        const textCount = 6;   // 文本数量

        for (let i = 0; i < textCount; i++) {
            // 在范围内随机生成文本的中心坐标
            let posX = Phaser.Math.Between(centerX - rangeWidth / 3, centerX + rangeWidth / 2);
            let posY = Phaser.Math.Between(centerY - rangeHeight / 2, centerY + rangeHeight / 2);

            // 根据 i 的奇偶性选择不同的颜色（这里使用十六进制字符串形式）
            const color = i % 2 === 0 ? "#C5B59B" : "#A79A8A";
            const ffont = i % 2 === 0 ? "X" : "+";

            // 创建文本对象，显示字符 "X"
            let textObj = this.scene.add.text(posX, posY, ffont, { fontSize: textSize + "px", color: color }).setDepth(depth);
            textObj.setOrigin(0.5, 0.5);
            this.scene.tweens.add({
                targets: textObj,
                alpha: 0.6,
                duration: 600,
                ease: 'Linear',
                onComplete: () => {
                    textObj.destroy();
                }
            });
        }
    }

    // Start slow effect animation (blue '*' symbol)
    public startSlowEffect() {
        if (this.slowEffectTimer) {
            return;
        }

        this.slowEffectTimer = this.scene.time.addEvent({
            delay: 800,  // Emit every second
            loop: true,
            callback: () => {
                const depth = DepthHelper.Mob.bodyText(this.body.depth);
                const centerX = this.x;
                const centerY = this.y - PositionManager.Instance.GRID_SIZEY / 2;
                const rangeWidth = PositionManager.Instance.GRID_SIZEX;
                const rangeHeight = PositionManager.Instance.GRID_SIZEY;
                const textSize = PositionManager.Instance.GRID_SIZEX / 5;
                const textCount = 6;

                for (let i = 0; i < textCount; i++) {
                    let posX = Phaser.Math.Between(centerX - rangeWidth / 3, centerX + rangeWidth / 2);
                    let posY = Phaser.Math.Between(centerY - rangeHeight / 2, centerY + rangeHeight / 2);

                    let textObj = this.scene.add.text(posX, posY, '*', { fontSize: textSize + "px", color: "#4A90E2" }).setDepth(depth);
                    textObj.setOrigin(0.5, 0.5);
                    this.scene.tweens.add({
                        targets: textObj,
                        alpha: 0.6,
                        duration: 600,
                        ease: 'Linear',
                        onComplete: () => {
                            textObj.destroy();
                        }
                    });
                }
            }
        });
    }

    // Stop slow effect animation
    public stopSlowEffect() {
        if (this.slowEffectTimer) {
            this.slowEffectTimer.remove();
            this.slowEffectTimer = undefined;
        }
    }

    public startFrozenEffect() {
        this.setTint(0x00FFFF);
    }

    public stopFrozenEffect() {
        this.setTint(0xFFFFFF);
    }

    setTint(color: number) {
        this.body.setTint(color);
        this.head.setTint(color);
        this.armLeft.setTint(color);
        this.armRight.setTint(color);
        this.legLeft.setTint(color);
        this.legRight.setTint(color);
    }

    destroy() {
        // Stop any existing tweens before destroying
        this.scene.tweens.killTweensOf([
            this.body,
            this.head,
            this.armLeft,
            this.armRight,
            this.legLeft,
            this.legRight
        ]);

        // Destroy all components
        this.body.destroy();
        this.head.destroy();
        this.armLeft.destroy();
        this.armRight.destroy();
        this.legLeft.destroy();
        this.legRight.destroy();

        // Stop and clean up leg and arm tweens
        this.legLeftTween?.stop();
        this.legRightTween?.stop();
        this.armTween?.stop();

        // 动画特效
        this.stopSlowEffect();
    }
} 
