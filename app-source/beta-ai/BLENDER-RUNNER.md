# Motor de renderizado Blender para Beta

Beta no ejecuta Blender dentro de Cloudflare Workers. Para renderizar escenas y animaciones se conecta a un servicio HTTPS externo que ejecute Blender en modo background.

## Contrato HTTP

La URL base se configura desde **Beta → Integraciones → Blender 3D**.

### Crear un trabajo

`POST /jobs`

JSON de entrada:

```json
{
  "prompt": "Un dragón azul volando sobre una ciudad futurista al atardecer",
  "format": "png",
  "animation": true
}
```

Respuesta HTTP 202:

```json
{
  "jobId": "job-123",
  "status": "queued",
  "message": "Escena en cola"
}
```

### Consultar el trabajo

`GET /jobs/{jobId}`

Mientras trabaja:

```json
{
  "jobId": "job-123",
  "status": "rendering",
  "message": "Renderizando fotogramas"
}
```

Al terminar, devolver:

```json
{
  "jobId": "job-123",
  "status": "completed",
  "images": [
    {
      "name": "render-01.png",
      "mimeType": "image/png",
      "url": "https://render.example/jobs/job-123/render-01.png"
    }
  ],
  "downloadUrl": "https://render.example/jobs/job-123/project.blend"
}
```

También se admite una imagen en base64 en el campo `data` en lugar de `url`.

Los estados terminales son `completed`, `complete`, `succeeded`, `failed` o `error`. Los errores deben incluir un campo `error` legible.

## Requisitos recomendados

- HTTPS público con autenticación propia entre Beta y el renderizador.
- Ejecutar Blender en modo headless/background, sin exponer una consola interactiva.
- Aislar cada trabajo en un directorio temporal y limitar CPU, memoria, duración y tamaño de archivos.
- No ejecutar scripts de usuario fuera del sandbox del renderizador.
- Limitar resolución, cantidad de fotogramas y duración de animación.
- Guardar los renders y archivos `.blend` con URLs temporales o privadas.
- Aplicar límites de concurrencia y limpiar archivos temporales.

## Importante

El panel de Beta y su API ya admiten guardar la URL, enviar trabajos y consultar el progreso. La generación real de geometría, animación y renders requiere desplegar un servicio que implemente este contrato. Guardar una URL por sí solo no instala Blender ni crea un motor de renderizado.
