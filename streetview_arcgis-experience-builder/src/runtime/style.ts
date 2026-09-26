import { css } from 'jimu-core'

const BRAND_COLOR = '#003865'
const BRAND_COLOR_LIGHT = '#5B8DB8'

export const getStyle = () => {
  return css`
    .widget-street-view {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 100%;
      box-sizing: border-box;
    }

    /* Panel fills the whole widget */
    .widget-street-view__panel {
      position: absolute;
      inset: 0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      overflow: hidden;
      background: #fff;
    }

    /* Header keeps its natural height */
    .widget-street-view__header {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 0;
      border-bottom: 3px solid ${BRAND_COLOR};
      padding-bottom: 10px;
    }

    .widget-street-view__title {
      font-weight: 700;
      font-size: 15px;
      color: ${BRAND_COLOR};
      letter-spacing: 0.2px;
    }

    .widget-street-view__hint {
      color: #666;
    }

    .widget-street-view__toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .widget-street-view__toolbar button.jimu-btn[type='primary'],
    .widget-street-view__toolbar .jimu-btn.btn-primary {
      background-color: ${BRAND_COLOR};
      border-color: ${BRAND_COLOR};
    }

    /* Preview area fills the space below the header */
    .widget-street-view__preview-area {
      flex: 1 1 0;
      height: 0;
      min-width: 0;
      position: relative;
    }

    /* Preview box fills the preview area */
    .widget-street-view__preview {
      position: absolute;
      inset: 0;
      border: 1px solid #d7e0e8;
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 12px 16px;
      gap: 8px;
      box-sizing: border-box;
      min-width: 0;
      box-shadow: 0 1px 3px rgba(0, 56, 101, 0.08);
    }

    .widget-street-view__preview-coords {
      flex: 0 0 auto;
      font-size: 12px;
      word-break: break-word;
      color: ${BRAND_COLOR};
    }

    .widget-street-view__actions a {
      color: ${BRAND_COLOR};
      font-weight: 600;
    }

    .widget-street-view__actions a:hover {
      color: ${BRAND_COLOR_LIGHT};
    }

    /* Iframe wrapper fills the remaining space in the preview */
    .widget-street-view__iframe-wrapper {
      position: relative;
      flex: 1 1 0;
      height: 0;
      min-width: 0;
      overflow: hidden;
    }

    .widget-street-view__iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: 4px;
      display: block;
    }

    .widget-street-view__actions {
      flex: 0 0 auto;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .widget-street-view__map-connection {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      pointer-events: none;
    }
  `
}