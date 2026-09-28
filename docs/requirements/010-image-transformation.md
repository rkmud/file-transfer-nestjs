# Technical Specification: Image Transformation Module (010-transfer-image-flow)

## 1. Overview and Architectural Principles

### 1.1 Purpose
The Image Transformation Module provides authenticated users with a secure, performant REST API for transforming image files across raster and vector formats (**PNG, JPEG, and SVG**). The service handles raster-to-raster conversions and SVG rasterization while strictly enforcing architectural constraints—specifically, prohibiting vectorization (raster-to-SVG conversion).

### 1.2 Key Architectural Principles
* **OOP and Extensibility:** Utilization of abstract interfaces and class hierarchies for transformation handlers. New image codecs or processors can be integrated without modifying controller contracts (Open/Closed Principle).
* **Streaming & Thread Pool Execution:** Image processing runs in dedicated, non-blocking worker thread pools. Converted file data is streamed directly back to the HTTP client to minimize memory overhead.
* **Local File Storage:** Original uploaded files and transformed output files are saved to the application's local file storage for audit trail and download reference.
* **Security-First Validation:** Mandatory sanitization for SVG vector files, decompression bomb detection for raster decoding, and strict limit validation prior to processing.

---

## 2. REST API Specification

### 2.1 Authorization
All endpoints require JWT authentication via an HTTP-only access cookie. Unauthenticated requests must be rejected immediately with HTTP `401 Unauthorized`.

---

### 2.2 Image Conversion Endpoint

**Endpoint:** `POST /api/images/convert`  
**Content-Type:** `multipart/form-data`

#### Request Parameters (Form Fields)

| Parameter | Type | Required | Description / Constraints |
| :--- | :--- | :--- | :--- |
| `file` | Binary | **Yes** | Input image file (`PNG`, `JPEG`, or `SVG`). Must be non-empty. |
| `targetFormat` | String | **Yes** | Desired output format. Allowed values: `png`, `jpeg`, `svg`. |
| `quality` | Integer | No | Quality factor for JPEG targets (1–100). Default: `85`. Ignored for non-JPEG targets. |
| `width` | Integer | No | Desired width in pixels for SVG rasterization. Must not exceed maximum configured resolution (`4096 px`). Default: SVG intrinsic width or system default (`1024 px`). |
| `height` | Integer | No | Desired height in pixels for SVG rasterization. Must not exceed maximum configured resolution (`4096 px`). Default: SVG intrinsic height or system default (`1024 px`). |
| `background` | String | No | Canvas background color for SVG rasterization (HEX string e.g., `#ffffff`, `#000000`). Default: `#ffffff`. **Valid only when converting SVG to PNG/JPEG**. Ignored for PNG/JPEG source files. |

#### Allowed Conversion Directions
* `PNG` → `JPEG`
* `JPEG` → `PNG`
* `SVG` → `PNG`
* `SVG` → `JPEG`

> **Strict Prohibition:** `PNG` → `SVG` and `JPEG` → `SVG` (Vectorization) are **permanently disabled and forbidden**. Requests attempting vectorization must immediately return HTTP `400 Bad Request`.

#### Processing Workflow
1. **Authentication Check:** Validate JWT access token from HTTP-only cookie.
2. **Form Parameter Parsing:** Extract binary `file`, `targetFormat`, and optional fields (`quality`, `width`, `height`, `background`).
3. **Format Detection & File Size Validation:**
   * Automatically detect source format via file signature (magic bytes) and MIME/extension check (`image/png`, `image/jpeg`, `image/svg+xml`).
   * Validate source file size against configured input size limits (`PNG_MAX_SIZE`, `JPEG_MAX_SIZE`, `SVG_MAX_SIZE`).
4. **Direction Compatibility Check:** Confirm the pair (`sourceFormat` → `targetFormat`) is supported.
5. **Security & Content Integrity Checks:**
   * **For SVG files:** Perform strict XML/SVG sanitization (strip `<script>` tags, inline event handlers such as `onload`/`onclick`, external DTDs, external URIs/resources).
   * **For Raster files (PNG/JPEG):** Validate against pixel bombs / decompression bombs (max total pixel count threshold).
6. **Transformation Execution:**
   * **Raster → Raster (PNG ↔ JPEG):** Decode source image into memory buffer; if output is JPEG, apply standard alpha channel flattening (to white background `#ffffff`) and `quality` factor.
   * **SVG → Raster (SVG → PNG/JPEG):** Rasterize vector graphics using target dimensions (`width`, `height`) and background color (`background`). Verify resulting image dimensions do not exceed configured limits (`MAX_RASTER_WIDTH`, `MAX_RASTER_HEIGHT`).
7. **Storage & Database Audit:** Save original and output files to Local Storage; persist operation audit record in Database.
8. **Streaming Output:** Stream converted image payload back to client.

#### Response Codes

* **`200 OK`**: Successful transformation. Returns streamed binary file.
  * **Headers:**
    * `Content-Type`: `image/png`, `image/jpeg`, or `image/svg+xml`
    * `Content-Disposition`: `attachment; filename="converted.<ext>"`
* **`400 Bad Request`**:
  * Invalid image payload or corrupted file syntax.
  * Attempted vectorization (`PNG`/`JPEG` → `SVG`).
  * Invalid parameters (e.g., `quality` outside 1–100 range, `background` non-hex string).
  * Exceeded rasterization output dimension limits (> 4096 px).
* **`401 Unauthorized`**: Missing, expired, or invalid JWT token.
* **`413 Payload Too Large`**: Input file size exceeds administrative limit for source format.
* **`415 Unsupported Media Type`**: File signature or extension is not a supported format (`PNG`, `JPEG`, `SVG`).

---

### 2.3 Supported Formats Discovery Endpoint

**Endpoint:** `GET /api/images/convert/formats`  
**Authentication:** Required (JWT)

#### Response `200 OK`
```json
[
  {
    "source": "png",
    "target": ["jpeg"]
  },
  {
    "source": "jpeg",
    "target": ["png"]
  },
  {
    "source": "svg",
    "target": ["png", "jpeg"]
  }
]
```

---

## 3. Transformation Logic & Handling Rules

### 3.1 Raster Processing (PNG ↔ JPEG)
* **PNG to JPEG:** JPEG does not support alpha channel transparency. When converting PNG to JPEG, transparent pixels are flattened against a solid white background (`#ffffff`) by default. The `quality` parameter determines compression level.
* **JPEG to PNG:** Lossless encoding. Transparency channel added with full opacity (255).

### 3.2 SVG Rasterization (SVG → PNG / JPEG)
* **Dimensions:** If `width` or `height` are omitted, the intrinsic viewBox/width/height from SVG markup is used. If intrinsic size is absent, default to `1024x1024`. Aspect ratio is preserved if only one dimension is supplied.
* **Background:** The `background` parameter specifies canvas color prior to rendering SVG paths. Default value is `#ffffff`.
* **Output Bounds:** Rendered pixel width and height must not exceed administrative bounds (`MAX_RASTER_WIDTH` = 4096 px, `MAX_RASTER_HEIGHT` = 4096 px).

---

## 4. Auditing, Logging, and Operation History

### 4.1 Database Operation History
Each transaction is persisted to the database upon completion or failure:
* `userId`: ID of the authenticated user.
* `sourceFormat`: Extracted input format (`png`, `jpeg`, `svg`).
* `targetFormat`: Target format requested (`png`, `jpeg`, `svg`).
* `sourceFileName`: Original uploaded filename.
* `sourceFilePath`: Local Storage path for input file.
* `targetFilePath`: Local Storage path for converted output file (null on failure).
* `fileSize`: Original file size in bytes.
* `status`: Operation status (`SUCCESS` | `ERROR`).
* `errorCode`: Detailed error identifier if failed (e.g., `VECTORIZATION_NOT_SUPPORTED`, `SVG_SANITY_FAILED`, `EXCEEDED_MAX_DIMENSIONS`).
* `createdAt`: Request timestamp.
* `completedAt`: Response timestamp.

### 4.2 Application Logging
* **Log Fields:** `userId`, `sourceFormat`, `targetFormat`, `fileSize`, `result` (`SUCCESS`/`ERROR`), `httpStatusCode`, `executionTimeMs`.
* **Security Rule:** Logging binary image content, base64 strings, or raw file buffers is **strictly prohibited**.

---

## 5. Security, Performance, and Standard Specifications

### 5.1 Security Requirements
* **SVG Sanitization:** Strip all active scripts (`<script>`), inline event handlers (`onload`, `onclick`), external entity references (`<!ENTITY>`), embedded frame links, and external URI downloads (`http://`, `https://`).
* **Decompression Bomb Protection:** Restrict total decoded memory buffer to a maximum pixel count threshold (50,000,000 pixels / ~50 MP).
* **Filename Sanitization:** Strip directory traversal characters (`..`, `/`, `\`) from input filenames before writing to Local Storage.

### 5.2 Default System Limits
* **Input File Size Limits:**
  * `PNG_MAX_SIZE`: `20 MB`
  * `JPEG_MAX_SIZE`: `20 MB`
  * `SVG_MAX_SIZE`: `10 MB`
* **Output Dimension Caps (SVG Rasterization):**
  * `MAX_RASTER_WIDTH`: `4096 px`
  * `MAX_RASTER_HEIGHT`: `4096 px`
* **Execution Timeout:** `30 seconds` per transaction thread.

### 5.3 Standards Compliance
* **PNG:** ISO/IEC 15948:2004 / W3C Recommendation
* **JPEG:** ISO/IEC 10918-1 / ITU-T T.81
* **SVG:** W3C SVG 1.1 / SVG 2.0 Recommendation
