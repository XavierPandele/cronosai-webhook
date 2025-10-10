# 📖 Ejemplos Prácticos de Uso

Colección completa de ejemplos para trabajar con la API de reservas.

---

## 📋 Índice

1. [Ejemplos con cURL](#ejemplos-con-curl)
2. [Ejemplos con JavaScript](#ejemplos-con-javascript)
3. [Ejemplos con Python](#ejemplos-con-python)
4. [Ejemplos con Postman](#ejemplos-con-postman)
5. [Casos de Uso Comunes](#casos-de-uso-comunes)

---

## 🔧 Ejemplos con cURL

### 1. Listar Todas las Reservas

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations
```

### 2. Obtener Reservas Confirmadas

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?status=confirmed"
```

### 3. Obtener Reservas de un Mes

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?fecha_inicio=2024-10-01&fecha_fin=2024-10-31"
```

### 4. Obtener una Reserva Específica

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"
```

### 5. Crear Nueva Reserva

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "nom_persona_reserva": "Pedro Sánchez",
    "telefon": "+34 656 789 012",
    "data_reserva": "2024-10-25 20:00:00",
    "num_persones": 4,
    "observacions": "Mesa junto a la ventana",
    "status": "pending"
  }' \
  https://tu-proyecto.vercel.app/api/reservations
```

### 6. Actualizar Estado de Reserva

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "status": "confirmed"
  }' \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"
```

### 7. Actualizar Varios Campos

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "status": "confirmed",
    "num_persones": 5,
    "observacions": "Cambiado a 5 personas, mesa grande confirmada"
  }' \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"
```

### 8. Eliminar Reserva

```bash
curl -X DELETE \
  -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"
```

### 9. Obtener Calendario del Mes Actual

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/calendar?mes=10&anio=2024"
```

### 10. Obtener Estadísticas

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/stats
```

---

## 💻 Ejemplos con JavaScript

### Configuración Base

```javascript
const API_BASE_URL = 'https://tu-proyecto.vercel.app';
const API_KEY = 'appsheet-cronos-2024';

const headers = {
  'Content-Type': 'application/json',
  'X-Api-Key': API_KEY
};
```

### 1. Función Helper para Fetch

```javascript
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const config = {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Error en la petición');
    }
    
    return data;
  } catch (error) {
    console.error('Error en API:', error);
    throw error;
  }
}
```

### 2. Obtener Todas las Reservas

```javascript
async function obtenerReservas() {
  const data = await apiRequest('/api/reservations');
  console.log(`Total de reservas: ${data.count}`);
  return data.data;
}

// Uso
obtenerReservas()
  .then(reservas => {
    reservas.forEach(r => {
      console.log(`${r.nom_persona_reserva} - ${r.data_reserva}`);
    });
  });
```

### 3. Filtrar Reservas por Estado

```javascript
async function obtenerReservasPorEstado(estado) {
  const data = await apiRequest(`/api/reservations?status=${estado}`);
  return data.data;
}

// Uso
const confirmadas = await obtenerReservasPorEstado('confirmed');
console.log(`Reservas confirmadas: ${confirmadas.length}`);
```

### 4. Crear Nueva Reserva

```javascript
async function crearReserva(reservaData) {
  const data = await apiRequest('/api/reservations', {
    method: 'POST',
    body: JSON.stringify(reservaData)
  });
  
  console.log('Reserva creada:', data.data.id_reserva);
  return data.data;
}

// Uso
const nuevaReserva = {
  nom_persona_reserva: 'Laura Martínez',
  telefon: '+34 667 890 123',
  data_reserva: '2024-10-28 19:30:00',
  num_persones: 2,
  observacions: 'Aniversario',
  status: 'pending'
};

crearReserva(nuevaReserva)
  .then(reserva => console.log('ID:', reserva.id_reserva));
```

### 5. Actualizar Reserva

```javascript
async function actualizarReserva(id, cambios) {
  const data = await apiRequest(`/api/reservations?id=${id}`, {
    method: 'PUT',
    body: JSON.stringify(cambios)
  });
  
  console.log('Reserva actualizada');
  return data.data;
}

// Uso
actualizarReserva(15, {
  status: 'confirmed',
  observacions: 'Mesa confirmada en terraza'
});
```

### 6. Eliminar Reserva

```javascript
async function eliminarReserva(id) {
  const data = await apiRequest(`/api/reservations?id=${id}`, {
    method: 'DELETE'
  });
  
  console.log('Reserva eliminada');
  return data.data;
}

// Uso
eliminarReserva(15)
  .then(() => console.log('Eliminada exitosamente'));
```

### 7. Obtener Reservas del Día

```javascript
async function obtenerReservasHoy() {
  const hoy = new Date().toISOString().split('T')[0];
  const data = await apiRequest(
    `/api/reservations?fecha_inicio=${hoy}&fecha_fin=${hoy}`
  );
  return data.data;
}

// Uso
obtenerReservasHoy()
  .then(reservas => {
    console.log(`Reservas de hoy: ${reservas.length}`);
    reservas.forEach(r => {
      console.log(`- ${r.nom_persona_reserva} a las ${r.data_reserva.split(' ')[1]}`);
    });
  });
```

### 8. Obtener Calendario con Estadísticas

```javascript
async function obtenerCalendario(mes, anio) {
  const data = await apiRequest(`/api/calendar?mes=${mes}&anio=${anio}`);
  
  console.log('Estadísticas:');
  console.log(`- Total reservas: ${data.stats.total_reservas}`);
  console.log(`- Total personas: ${data.stats.total_personas}`);
  console.log(`- Pendientes: ${data.stats.por_estado.pending}`);
  console.log(`- Confirmadas: ${data.stats.por_estado.confirmed}`);
  
  return data.events;
}

// Uso
const eventos = await obtenerCalendario(10, 2024);
```

### 9. Buscar Cliente por Teléfono

```javascript
async function buscarPorTelefono(telefono) {
  const data = await apiRequest(`/api/reservations?telefon=${telefono}`);
  return data.data;
}

// Uso
const reservasCliente = await buscarPorTelefono('+34612345678');
console.log(`El cliente tiene ${reservasCliente.length} reservas`);
```

### 10. Clase Completa para Gestión de Reservas

```javascript
class ReservasAPI {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
        ...options.headers
      }
    };

    const response = await fetch(url, config);
    const data = await response.json();
    
    if (!response.ok) throw new Error(data.error);
    return data;
  }

  // GET
  async listar(filtros = {}) {
    const params = new URLSearchParams(filtros).toString();
    const endpoint = params ? `/api/reservations?${params}` : '/api/reservations';
    return await this.request(endpoint);
  }

  async obtener(id) {
    return await this.request(`/api/reservations?id=${id}`);
  }

  // POST
  async crear(reserva) {
    return await this.request('/api/reservations', {
      method: 'POST',
      body: JSON.stringify(reserva)
    });
  }

  // PUT
  async actualizar(id, cambios) {
    return await this.request(`/api/reservations?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify(cambios)
    });
  }

  // DELETE
  async eliminar(id) {
    return await this.request(`/api/reservations?id=${id}`, {
      method: 'DELETE'
    });
  }

  // CALENDAR
  async calendario(mes, anio) {
    return await this.request(`/api/calendar?mes=${mes}&anio=${anio}`);
  }

  // STATS
  async estadisticas() {
    return await this.request('/api/stats');
  }
}

// Uso
const api = new ReservasAPI(
  'https://tu-proyecto.vercel.app',
  'appsheet-cronos-2024'
);

// Listar reservas confirmadas
const confirmadas = await api.listar({ status: 'confirmed' });

// Crear reserva
const nueva = await api.crear({
  nom_persona_reserva: 'Test User',
  telefon: '+34600000000',
  data_reserva: '2024-10-30 20:00:00',
  num_persones: 2
});

// Actualizar
await api.actualizar(nueva.data.id_reserva, { status: 'confirmed' });

// Obtener estadísticas
const stats = await api.estadisticas();
console.log(stats);
```

---

## 🐍 Ejemplos con Python

### 1. Configuración Base

```python
import requests
import json
from datetime import datetime, timedelta

API_BASE_URL = 'https://tu-proyecto.vercel.app'
API_KEY = 'appsheet-cronos-2024'

headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': API_KEY
}
```

### 2. Función Helper

```python
def api_request(endpoint, method='GET', data=None):
    url = f"{API_BASE_URL}{endpoint}"
    
    try:
        if method == 'GET':
            response = requests.get(url, headers=headers)
        elif method == 'POST':
            response = requests.post(url, headers=headers, json=data)
        elif method == 'PUT':
            response = requests.put(url, headers=headers, json=data)
        elif method == 'DELETE':
            response = requests.delete(url, headers=headers)
        
        response.raise_for_status()
        return response.json()
    
    except requests.exceptions.RequestException as e:
        print(f"Error en la petición: {e}")
        raise
```

### 3. Listar Reservas

```python
def listar_reservas(filtros=None):
    endpoint = '/api/reservations'
    
    if filtros:
        params = '&'.join([f"{k}={v}" for k, v in filtros.items()])
        endpoint += f"?{params}"
    
    data = api_request(endpoint)
    print(f"Total de reservas: {data['count']}")
    return data['data']

# Uso
reservas = listar_reservas()
for r in reservas:
    print(f"{r['nom_persona_reserva']} - {r['data_reserva']}")
```

### 4. Crear Reserva

```python
def crear_reserva(reserva_data):
    data = api_request('/api/reservations', method='POST', data=reserva_data)
    print(f"Reserva creada con ID: {data['data']['id_reserva']}")
    return data['data']

# Uso
nueva_reserva = {
    'nom_persona_reserva': 'Carmen Díaz',
    'telefon': '+34 678 901 234',
    'data_reserva': '2024-10-29 21:00:00',
    'num_persones': 3,
    'observacions': 'Vegetariano',
    'status': 'pending'
}

reserva = crear_reserva(nueva_reserva)
```

### 5. Actualizar Reserva

```python
def actualizar_reserva(id_reserva, cambios):
    endpoint = f'/api/reservations?id={id_reserva}'
    data = api_request(endpoint, method='PUT', data=cambios)
    print("Reserva actualizada exitosamente")
    return data['data']

# Uso
actualizar_reserva(15, {
    'status': 'confirmed',
    'observacions': 'Mesa confirmada'
})
```

### 6. Eliminar Reserva

```python
def eliminar_reserva(id_reserva):
    endpoint = f'/api/reservations?id={id_reserva}'
    data = api_request(endpoint, method='DELETE')
    print("Reserva eliminada")
    return data['data']

# Uso
eliminar_reserva(15)
```

### 7. Obtener Reservas de Hoy

```python
def reservas_hoy():
    hoy = datetime.now().strftime('%Y-%m-%d')
    
    filtros = {
        'fecha_inicio': hoy,
        'fecha_fin': hoy
    }
    
    reservas = listar_reservas(filtros)
    
    print(f"\nReservas de hoy ({hoy}):")
    for r in reservas:
        hora = r['data_reserva'].split(' ')[1]
        print(f"- {hora} | {r['nom_persona_reserva']} | {r['num_persones']} personas")
    
    return reservas

# Uso
reservas_hoy()
```

### 8. Clase Completa

```python
class ReservasAPI:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.headers = {
            'Content-Type': 'application/json',
            'X-Api-Key': api_key
        }
    
    def _request(self, endpoint, method='GET', data=None):
        url = f"{self.base_url}{endpoint}"
        
        if method == 'GET':
            response = requests.get(url, headers=self.headers)
        elif method == 'POST':
            response = requests.post(url, headers=self.headers, json=data)
        elif method == 'PUT':
            response = requests.put(url, headers=self.headers, json=data)
        elif method == 'DELETE':
            response = requests.delete(url, headers=self.headers)
        
        response.raise_for_status()
        return response.json()
    
    def listar(self, **filtros):
        endpoint = '/api/reservations'
        if filtros:
            params = '&'.join([f"{k}={v}" for k, v in filtros.items()])
            endpoint += f"?{params}"
        return self._request(endpoint)
    
    def obtener(self, id_reserva):
        return self._request(f'/api/reservations?id={id_reserva}')
    
    def crear(self, reserva):
        return self._request('/api/reservations', method='POST', data=reserva)
    
    def actualizar(self, id_reserva, cambios):
        return self._request(f'/api/reservations?id={id_reserva}', method='PUT', data=cambios)
    
    def eliminar(self, id_reserva):
        return self._request(f'/api/reservations?id={id_reserva}', method='DELETE')
    
    def calendario(self, mes, anio):
        return self._request(f'/api/calendar?mes={mes}&anio={anio}')
    
    def estadisticas(self):
        return self._request('/api/stats')

# Uso
api = ReservasAPI(
    'https://tu-proyecto.vercel.app',
    'appsheet-cronos-2024'
)

# Listar
reservas = api.listar(status='confirmed')
print(f"Reservas confirmadas: {reservas['count']}")

# Crear
nueva = api.crear({
    'nom_persona_reserva': 'Test',
    'telefon': '+34600000000',
    'data_reserva': '2024-10-31 20:00:00',
    'num_persones': 2
})

# Estadísticas
stats = api.estadisticas()
print(f"Total reservas: {stats['data']['estadisticas_generales']['total_reservas']}")
```

---

## 📮 Ejemplos con Postman

### 1. Importar Colección

Guarda este JSON como `reservas-api.postman_collection.json`:

```json
{
  "info": {
    "name": "Reservas API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "GET Reservas",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "X-Api-Key",
            "value": "{{api_key}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/reservations",
          "host": ["{{base_url}}"],
          "path": ["api", "reservations"]
        }
      }
    },
    {
      "name": "POST Crear Reserva",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "X-Api-Key",
            "value": "{{api_key}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"nom_persona_reserva\": \"Test User\",\n  \"telefon\": \"+34 600 000 000\",\n  \"data_reserva\": \"2024-10-30 20:00:00\",\n  \"num_persones\": 2,\n  \"observacions\": \"Test\",\n  \"status\": \"pending\"\n}"
        },
        "url": {
          "raw": "{{base_url}}/api/reservations",
          "host": ["{{base_url}}"],
          "path": ["api", "reservations"]
        }
      }
    }
  ],
  "variable": [
    {
      "key": "base_url",
      "value": "https://tu-proyecto.vercel.app"
    },
    {
      "key": "api_key",
      "value": "appsheet-cronos-2024"
    }
  ]
}
```

---

## 💡 Casos de Uso Comunes

### 1. Dashboard en Tiempo Real

```javascript
async function actualizarDashboard() {
  const stats = await fetch(`${API_BASE_URL}/api/stats`, { headers })
    .then(r => r.json());
  
  document.getElementById('total-reservas').textContent = 
    stats.data.estadisticas_generales.total_reservas;
  
  document.getElementById('pendientes').textContent = 
    stats.data.estadisticas_generales.por_estado.pending;
  
  // Actualizar cada 30 segundos
  setTimeout(actualizarDashboard, 30000);
}
```

### 2. Confirmar Todas las Pendientes del Día

```python
def confirmar_pendientes_hoy():
    hoy = datetime.now().strftime('%Y-%m-%d')
    
    # Obtener pendientes de hoy
    reservas = listar_reservas({
        'status': 'pending',
        'fecha_inicio': hoy,
        'fecha_fin': hoy
    })
    
    # Confirmar cada una
    for reserva in reservas:
        actualizar_reserva(reserva['id_reserva'], {'status': 'confirmed'})
        print(f"✅ Confirmada: {reserva['nom_persona_reserva']}")
    
    print(f"\nTotal confirmadas: {len(reservas)}")

confirmar_pendientes_hoy()
```

### 3. Reporte Semanal

```python
def generar_reporte_semanal():
    # Calcular fechas
    hoy = datetime.now()
    inicio_semana = hoy - timedelta(days=7)
    
    # Obtener reservas
    reservas = listar_reservas({
        'fecha_inicio': inicio_semana.strftime('%Y-%m-%d'),
        'fecha_fin': hoy.strftime('%Y-%m-%d')
    })
    
    print("\n" + "="*50)
    print("REPORTE SEMANAL DE RESERVAS")
    print("="*50)
    print(f"Período: {inicio_semana.date()} a {hoy.date()}")
    print(f"\nTotal reservas: {len(reservas)}")
    
    # Por estado
    estados = {}
    for r in reservas:
        estado = r['status']
        estados[estado] = estados.get(estado, 0) + 1
    
    print("\nPor estado:")
    for estado, cantidad in estados.items():
        print(f"  - {estado}: {cantidad}")
    
    # Total personas
    total_personas = sum(r['num_persones'] for r in reservas)
    print(f"\nTotal personas atendidas: {total_personas}")
    print(f"Promedio personas por reserva: {total_personas/len(reservas):.2f}")

generar_reporte_semanal()
```

---

**Última actualización:** Octubre 2024

