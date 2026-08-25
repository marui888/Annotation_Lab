import './PreviewControlOverlay.css'

export default function PreviewControlOverlay({
  backgroundColor = '#ffffff',
  onBackgroundColorChange,
  onScaleChange,
  onScaleReset,
  onShowFrameChange,
  scale = 1,
  showFrame = true,
}) {
  return (
    <div className="preview-control-overlay" aria-label="Preview display controls">
      <div className="preview-control-row">
        <div className="preview-control-group zoom">
          <button data-tooltip="Smaller Preview" onClick={() => onScaleChange?.(-0.1)} type="button">-</button>
          <button data-tooltip="Reset Preview Size" onClick={() => onScaleReset?.()} type="button">
            {Math.round(scale * 100)}%
          </button>
          <button data-tooltip="Larger Preview" onClick={() => onScaleChange?.(0.1)} type="button">+</button>
        </div>
      </div>
      <div className="preview-control-row">
        <label className="preview-control-group color" data-tooltip="Preview Background">
          <span>Bg</span>
          <input
            aria-label="Preview Background"
            onChange={(event) => onBackgroundColorChange?.(event.target.value)}
            type="color"
            value={backgroundColor}
          />
        </label>
      </div>
      <div className="preview-control-row">
        <label className="preview-control-group frame" data-tooltip="Show A Frame">
          <span>Frame</span>
          <input
            checked={showFrame}
            onChange={(event) => onShowFrameChange?.(event.target.checked)}
            type="checkbox"
          />
        </label>
      </div>
    </div>
  )
}
