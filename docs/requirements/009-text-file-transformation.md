# Technical Specification: Text File Transformation Module (009-transfer-text-files)

## 1. Overview and Architectural Principles

### 1.1 Purpose
The module is designed for high-performance and secure data conversion between text formats: **CSV, JSON, XML, and YAML** (a total of 12 conversion directions).

### 1.2 Architectural Standards
* **Extensibility and OOP:** Utilization of abstract classes and interfaces for services and controllers. Adding new conversion modules must not alter existing contracts (Open/Closed Principle).
* **Streaming and Multithreading:** File processing is performed in a separate thread pool with streaming support to prevent blocking the main application thread and minimize RAM consumption.
* **Local Storage:** Processed and result files are saved to the application's local file system (Local Storage).

---

## 2. REST API Specification

### 2.1 Authorization
All endpoints require user authentication via `access JWT` (passed in HTTP-only Cookie). Requests without a valid token are rejected with a `401 Unauthorized` status.

### 2.2 File Conversion Endpoint
`POST /api/convert`

* **Request Format:** `multipart/form-data`
* **Parameters:**
  * `file`: `binary` (required, non-empty file).
  * `targetFormat`: `string` (required, allowed values: `csv`, `json`, `xml`, `yaml`).
* **Processing Algorithm:**
  1. Validate the presence and non-emptiness of the file, verify presence and validity of `targetFormat`.
  2. Automatically detect the source format by file extension and content.
  3. Verify file size against the administrator-defined limit for the given input format.
  4. Parse the source file into an internal representation (object/array/table).
  5. Transform the internal representation into the target format according to ambiguity handling rules.
  6. Serialize into the target format.
  7. Save the file to local storage and return the response as a stream.
* **Response Codes:**
  * `200 OK`: Successful conversion. Streaming file returned.
    * Headers: `Content-Type: <mime-type-target-format>`, `Content-Disposition: attachment; filename="converted.<ext>"`.
  * `400 Bad Request`: Invalid file, parsing syntax errors, or invalid parameters.
  * `401 Unauthorized`: User is not authenticated.
  * `413 Payload Too Large`: Input file size exceeds the established administrative limit.
  * `415 Unsupported Media Type`: Unsupported source or target format.

### 2.3 Supported Formats Endpoint
`GET /api/convert/formats`

* **Requirements:** JWT Authentication.
* **Response `200 OK`:** JSON array of objects describing supported conversion matrices (12 directions):
  ```json
  [
    {
      "source": "csv",
      "target": ["json", "xml", "yaml"]
    },
    {
      "source": "json",
      "target": ["csv", "xml", "yaml"]
    },
    {
      "source": "xml",
      "target": ["csv", "json", "yaml"]
    },
    {
      "source": "yaml",
      "target": ["csv", "json", "xml"]
    }
  ]
  ```

---

## 3. Transformation Logic and Ambiguity Handling

Regular conversion between all possible format pairs is supported. For complex structured transformations, the following fixed rules apply:

1. **CSV ↔ JSON / YAML / XML:**
   * When converting from CSV, rows are converted into an array of objects (using header row keys) or an array of arrays (if headers are absent).
   * When converting to CSV, nested objects or flattened structures are serialized using dot notation (e.g., `address.city`) or JSON strings.
2. **XML ↔ JSON / YAML:**
   * XML tag attributes are converted into JSON fields with a `@` prefix (e.g., `@id`).
   * Repeating XML elements are converted into JSON arrays.
   * When converting from JSON to XML, a single root element `<root>` is created.
3. **Encoding and Unicode:**
   * Mandatory support for UTF-8.
   * Correct handling and removal/consideration of Byte Order Mark (BOM).

---

## 4. Auditing, Logging, and Operation History

### 4.1 Database Operation History
Each conversion operation is recorded in the database, capturing the following data:
* User identifier (`userId`).
* Input and output file metadata (name, format, local storage path).
* Final processing status (`SUCCESS`, `ERROR`).
* Timestamps (`createdAt`, `completedAt`).

### 4.2 System Logging
* **Logged Parameters:** `userId`, `sourceFormat`, `targetFormat`, `fileSize`, result (`success` / `error` + code), processing duration (ms).
* **Critical Security Constraint:** Logging file content is **strictly prohibited**.

---

## 5. Security, Performance, and Standard Requirements

### 5.1 Security
* **XXE (XML External Entity) Protection:** Complete prohibition of external entities and DTD during XML parsing.
* Nesting depth and document size limits to protect against resource exhaustion attacks (e.g., "Billion Laughs", YAML circular references).
* Validation and sanitization of all incoming filenames and parameters.

### 5.2 Performance and Reliability
* **Timeout:** Processing time limit per transaction (e.g., 30 seconds).
* **Atomicity:** In case of an error, the client receives a corresponding error code; partially generated files are not delivered.
* **Limit Configuration:** File size limits are configured separately per input format (`CSV_MAX_SIZE`, `JSON_MAX_SIZE`, `XML_MAX_SIZE`, `YAML_MAX_SIZE`).

### 5.3 Supported Standards
* **JSON:** RFC 8259
* **YAML:** Version 1.2
* **XML:** Version 1.0 (W3C)
* **CSV:** RFC 4180
