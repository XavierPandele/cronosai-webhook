# 📱 Relación entre RESERVA y CLIENT en AppSheet

Guía completa para configurar la relación entre las tablas RESERVA y CLIENT en AppSheet, permitiendo que al seleccionar un teléfono en RESERVA se auto-complete automáticamente el nombre del cliente desde CLIENT.

---

## 🎯 Objetivo

Cuando se crea una nueva reserva en la tabla **RESERVA** y se selecciona el campo `telefon`, automáticamente se debe mostrar en el campo `nom_persona_reserva` el valor del campo `nom_complet` de la tabla **CLIENT**, basándose en la relación entre `telefon` (RESERVA) y `telefon` (CLIENT).

---

## 📊 Estructura de las Tablas

### Tabla RESERVA
```
- id_reserva (Primary Key)
- data_reserva (DateTime)
- num_persones (Number)
- telefon (Text) ← Campo de referencia
- nom_persona_reserva (Text) ← Campo a auto-completar
- observacions (Text)
- status (Text)
- created_at (DateTime)
- updated_at (DateTime)
```

### Tabla CLIENT
```
- telefon (Primary Key) ← Campo de referencia
- nom_complet (Text) ← Campo fuente para auto-completar
- data_ultima_reserva (DateTime)
```

### Relación
- **RESERVA.telefon** → Referencia a → **CLIENT.telefon**
- **RESERVA.nom_persona_reserva** ← Obtiene valor de ← **CLIENT.nom_complet**

---

## 🔧 Configuración Paso a Paso

### Paso 1: Configurar la Tabla CLIENT como Data Source

1. Ve a **Data > Tables** en AppSheet
2. Si no existe, crea la tabla **CLIENT**:
   - **Table Name:** `CLIENT`
   - **Data Source:** Tu fuente de datos (MySQL, API, Google Sheets, etc.)
   - Asegúrate de que el campo `telefon` esté marcado como **Key** o **Primary Key**

### Paso 2: Configurar la Tabla RESERVA

1. Ve a **Data > Tables > RESERVA**
2. Asegúrate de que la tabla RESERVA está configurada correctamente
3. Verifica que el campo `telefon` existe en la tabla

### Paso 3: Crear la Relación entre Tablas

1. Ve a **Data > Tables > RESERVA**
2. Selecciona el campo **`telefon`**
3. En las propiedades del campo, busca la sección **"Reference"** o **"Lookup"**
4. Configura la referencia:
   - **Reference Type:** `Table Reference` o `Lookup`
   - **Reference Table:** `CLIENT`
   - **Reference Key Column:** `telefon`
   - **Display Column:** `nom_complet` (opcional, para mostrar en el selector)
   - **Allow Lookup:** `Yes`

**Sintaxis en AppSheet:**
```
Reference Table: CLIENT
Reference Key: CLIENT[telefon]
Display: CLIENT[nom_complet]
```

### Paso 4: Configurar Auto-completado en nom_persona_reserva

1. Ve a **Data > Tables > RESERVA**
2. Selecciona el campo **`nom_persona_reserva`**
3. En las propiedades del campo, ve a **"Initial Value"** o **"Default Value"**
4. Configura una fórmula que obtenga el valor de CLIENT basándose en el teléfono seleccionado

**Fórmula para Auto-completado (RECOMENDADA - Usa LOOKUP con sintaxis correcta):**

```
IF(
  ISBLANK([telefon]),
  "",
  LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
)
```

**Alternativa usando SELECT:**

```
IF(
  ISBLANK([telefon]),
  "",
  ANY(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
)
```

**⚠️ NOTA IMPORTANTE sobre LOOKUP():** 
- La sintaxis correcta es: `LOOKUP(_value_, _dataset_, _column_, _return-column_)`
- Todos los parámetros de tabla y columna deben ser **texto literal** entre comillas
- Usa `[_THISROW].[telefon]` para referenciar la columna de la fila actual y evitar ambigüedades
- Referencia oficial: [AppSheet LOOKUP() Documentation](https://support.google.com/appsheet/answer/10107410)

### Paso 5: Configurar el Campo telefon como Selector

1. Ve a **Data > Tables > RESERVA > telefon**
2. En **"Control Type"**, selecciona: **"Reference"** o **"Lookup"**
3. Configura:
   - **Reference Table:** `CLIENT`
   - **Key Column:** `telefon`
   - **Display Column:** `nom_complet` (para mostrar nombre al seleccionar)
   - **Show Search:** `Yes` (para buscar por nombre o teléfono)
   - **Allow Add New:** `Yes` (opcional, si quieres permitir agregar nuevos clientes)

### Paso 6: Configurar Actualización Automática

Para que el campo `nom_persona_reserva` se actualice automáticamente cuando cambia `telefon`:

1. Ve a **Data > Tables > RESERVA**
2. Selecciona el campo **`nom_persona_reserva`**
3. En **"Column Properties"**, busca **"Refresh"** o **"Refresh When"**
4. Configura: **"Refresh when [telefon] changes"**

O usa una fórmula reactiva:

```
IF(
  ISBLANK([telefon]),
  "",
  LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
)
```

---

## 📝 Fórmulas Detalladas para AppSheet

### ⚠️ IMPORTANTE: Sintaxis Correcta de LOOKUP()
Según la [documentación oficial de AppSheet](https://support.google.com/appsheet/answer/10107410), la sintaxis correcta de `LOOKUP()` es:

```
LOOKUP(_value_, _dataset_, _column_, _return-column_)
```

**Parámetros:**
- `_value_`: El valor a buscar (ej: `[_THISROW].[telefon]`)
- `_dataset_`: Nombre de la tabla como **texto literal** entre comillas (ej: `"CLIENT"`)
- `_column_`: Nombre de la columna donde buscar como **texto literal** (ej: `"telefon"`)
- `_return-column_`: Nombre de la columna a devolver como **texto literal** (ej: `"nom_complet"`)

**⚠️ CRÍTICO:** Los parámetros `_dataset_`, `_column_`, y `_return-column_` **DEBEN** ser texto literal entre comillas, NO expresiones ni referencias de columna.

### ✅ Fórmula 1: LOOKUP (RECOMENDADA - Sintaxis oficial)
Esta es la forma correcta según la documentación oficial:

```
IF(
  ISBLANK([telefon]),
  "",
  LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
)
```

**Cómo funciona:**
- `LOOKUP()` busca en la tabla "CLIENT" el registro donde la columna "telefon" coincida con el valor de `[_THISROW].[telefon]`
- Devuelve el valor de la columna "nom_complet" del registro encontrado
- `[_THISROW].[telefon]` referencia explícitamente la columna de la fila actual para evitar ambigüedades

### ✅ Fórmula 2: LOOKUP con Manejo de Errores
```
IF(
  ISBLANK([telefon]),
  "",
  IFERROR(
    LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet"),
    ""
  )
)
```

### ✅ Fórmula 3: LOOKUP Simplificado (Si no hay ambigüedad)
En algunos contextos puedes usar directamente `[telefon]` sin `[_THISROW]`:

```
IF(
  ISBLANK([telefon]),
  "",
  LOOKUP([telefon], "CLIENT", "telefon", "nom_complet")
)
```

**Nota:** Si obtienes resultados incorrectos, usa `[_THISROW].[telefon]` en su lugar.

### ✅ Fórmula 4: SELECT con ANY (Alternativa equivalente)
Según la documentación, `LOOKUP()` es equivalente a usar `ANY(SELECT(...))`:

```
IF(
  ISBLANK([telefon]),
  "",
  ANY(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
)
```

### ✅ Fórmula 5: SELECT con FIRST (Alternativa)
```
IF(
  ISBLANK([telefon]),
  "",
  FIRST(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
)
```

### ✅ Fórmula 6: Con Valor por Defecto si no existe
```
IF(
  ISBLANK([telefon]),
  "",
  COALESCE(
    LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet"),
    "Cliente no encontrado"
  )
)
```

### ❌ NO USAR: LOOKUP con sintaxis incorrecta
```
❌ LOOKUP(CLIENT[nom_complet], CLIENT[telefon] = [telefon])  // ERROR
❌ LOOKUP([telefon], CLIENT, telefon, nom_complet)  // ERROR - falta comillas
```

**Razones:**
- El segundo parámetro debe ser texto literal entre comillas: `"CLIENT"`
- Los nombres de columnas deben ser texto literal entre comillas: `"telefon"`, `"nom_complet"`
- NO se pueden usar referencias de columna como `CLIENT[telefon]` en los parámetros de tabla/columna

---

## 🎨 Configuración en el Formulario

### Paso 1: Crear/Editar Vista de Formulario

1. Ve a **UX > Views**
2. Selecciona o crea una vista de tipo **"Form"** para RESERVA
3. Configura los campos del formulario

### Paso 2: Configurar Campo telefon

1. En el formulario, selecciona el campo **`telefon`**
2. Configura:
   - **Control Type:** `Reference` o `Lookup`
   - **Reference Table:** `CLIENT`
   - **Show:** `nom_complet` (nombre) y `telefon` (teléfono)
   - **Search Fields:** `nom_complet`, `telefon`
   - **Display Format:** `"[nom_complet] - [telefon]"`

### Paso 3: Configurar Campo nom_persona_reserva

1. En el formulario, selecciona el campo **`nom_persona_reserva`**
2. Configura:
   - **Control Type:** `Text` o `Display`
   - **Read Only:** `Yes` (recomendado, para que se auto-complete)
   - **Initial Value:** Usa una de las fórmulas del Paso 6

---

## 🔄 Configuración Avanzada: Actualización en Tiempo Real

### Opción 1: Usar App Formula con Refresh

1. Ve a **Data > Tables > RESERVA**
2. Crea una **Virtual Column** llamada `_nom_persona_auto`:
   ```
   Type: App Formula
   Formula: LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
   ```
3. En el campo `nom_persona_reserva`, usa:
   ```
   Initial Value: [_nom_persona_auto]
   Refresh: Yes
   ```

### Opción 2: Usar Action para Actualizar

1. Ve a **UX > Actions**
2. Crea una nueva acción: **"Actualizar Nombre Cliente"**
3. Configura:
   ```
   Action Type: Update Row
   Table: RESERVA
   Condition: [telefon] IS NOT BLANK
   Update: [nom_persona_reserva] = LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
   ```
4. Configura esta acción para que se ejecute cuando cambie `telefon`

---

## ✅ Verificación y Pruebas

### Checklist de Verificación

- [ ] Tabla CLIENT configurada con `telefon` como Key
- [ ] Tabla RESERVA configurada correctamente
- [ ] Campo `telefon` en RESERVA tiene referencia a CLIENT
- [ ] Campo `nom_persona_reserva` tiene fórmula de lookup
- [ ] Formulario muestra selector de teléfono con nombres
- [ ] Al seleccionar teléfono, se actualiza automáticamente el nombre
- [ ] Si el teléfono no existe en CLIENT, se maneja correctamente

### Pruebas a Realizar

1. **Prueba 1: Cliente Existente**
   - Selecciona un teléfono que existe en CLIENT
   - Verifica que `nom_persona_reserva` se llena automáticamente

2. **Prueba 2: Cliente Nuevo**
   - Selecciona un teléfono que NO existe en CLIENT
   - Verifica el comportamiento (debe permitir agregar o mostrar mensaje)

3. **Prueba 3: Cambio de Teléfono**
   - Selecciona un teléfono
   - Cambia a otro teléfono
   - Verifica que el nombre se actualiza

4. **Prueba 4: Teléfono Vacío**
   - Deja el campo `telefon` vacío
   - Verifica que `nom_persona_reserva` esté vacío

---

## 🐛 Solución de Problemas

### Problema 1: Error "LOOKUP() requires the second argument to be a table name text literal"

**Causa:** Estás usando `LOOKUP()` con sintaxis incorrecta. Los parámetros de tabla y columna deben ser texto literal entre comillas.

**Solución:**
- **NO uses** `LOOKUP(CLIENT[nom_complet], CLIENT[telefon] = [telefon])` ❌
- **NO uses** `LOOKUP([telefon], CLIENT, telefon, nom_complet)` ❌ (falta comillas)
- **USA** `LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")` ✅
- Asegúrate de que el nombre de la tabla esté entre comillas: `"CLIENT"`
- Asegúrate de que los nombres de columnas estén entre comillas: `"telefon"`, `"nom_complet"`
- Referencia oficial: [AppSheet LOOKUP() Documentation](https://support.google.com/appsheet/answer/10107410)

### Problema 2: El nombre no se actualiza automáticamente

**Solución:**
- Verifica que la fórmula esté correctamente configurada usando la sintaxis oficial de `LOOKUP()`
- Usa `[_THISROW].[telefon]` para referenciar explícitamente la columna de la fila actual
- Asegúrate de que el campo `telefon` tenga la referencia correcta
- Verifica que los nombres de las tablas y columnas coincidan exactamente (mayúsculas/minúsculas)
- Prueba refrescar los datos: **Data > Refresh Data**
- Verifica que el campo tenga "Refresh when [telefon] changes" habilitado

### Problema 3: Error "Table not found" o "Column not found"

**Solución:**
- Verifica que ambas tablas estén correctamente configuradas
- Verifica que los nombres de las tablas sean exactos (mayúsculas/minúsculas)
- Verifica que los nombres de las columnas coincidan

### Problema 4: Resultados incorrectos o múltiples coincidencias

**Causa:** `LOOKUP()` evalúa expresiones desde la perspectiva de la tabla de búsqueda, no de la tabla actual.

**Solución:**
- Usa `[_THISROW].[telefon]` en lugar de solo `[telefon]` para referenciar explícitamente la fila actual
- Asegúrate de que `telefon` sea único en CLIENT (Primary Key)
- Si hay múltiples coincidencias, `LOOKUP()` devuelve solo un valor (el primero encontrado)
- Verifica que no haya duplicados en la tabla CLIENT
- Alternativa: Usa `ANY(SELECT(...))` que es equivalente a `LOOKUP()` según la documentación

### Problema 5: El selector no muestra nombres

**Solución:**
- Configura el campo `telefon` como Reference con Display Column
- Verifica que `nom_complet` esté disponible en CLIENT
- Configura el formato de visualización en el selector

### Problema 6: Datos no se sincronizan

**Solución:**
- Verifica la conexión a la fuente de datos
- Refresca los datos: **Data > Refresh Data**
- Verifica que los permisos de lectura estén correctos
- Revisa los logs en AppSheet Monitor

---

## 📚 Referencias y Sintaxis AppSheet

### Funciones AppSheet Utilizadas

- **LOOKUP()**: ✅ **RECOMENDADA** - Función oficial de AppSheet para buscar valores en tablas
- **SELECT()**: Selecciona múltiples filas que cumplen una condición
- **ANY()**: Obtiene cualquier elemento de una lista (equivalente a `LOOKUP()`)
- **FIRST()**: Obtiene el primer elemento de una lista
- **IF()**: Condicional
- **ISBLANK()**: Verifica si un valor está vacío
- **COALESCE()**: Devuelve el primer valor no nulo
- **IFERROR()**: Maneja errores y devuelve un valor por defecto

### ✅ Sintaxis de LOOKUP() (OFICIAL - RECOMENDADA)

Según la [documentación oficial de AppSheet](https://support.google.com/appsheet/answer/10107410):

```
LOOKUP(_value_, _dataset_, _column_, _return-column_)
```

**Ejemplo:**
```
LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
```

**Parámetros:**
- `_value_`: Valor a buscar (ej: `[_THISROW].[telefon]` o `[telefon]`)
- `_dataset_`: Nombre de la tabla como **texto literal entre comillas** (ej: `"CLIENT"`)
- `_column_`: Nombre de la columna donde buscar como **texto literal entre comillas** (ej: `"telefon"`)
- `_return-column_`: Nombre de la columna a devolver como **texto literal entre comillas** (ej: `"nom_complet"`)

**⚠️ CRÍTICO:**
- Los parámetros `_dataset_`, `_column_`, y `_return-column_` **DEBEN** ser texto literal entre comillas
- NO se pueden usar expresiones ni referencias de columna en estos parámetros
- Usa `[_THISROW].[telefon]` para referenciar explícitamente la columna de la fila actual

### ✅ Sintaxis de SELECT con ANY (Equivalente a LOOKUP)

Según la documentación, `LOOKUP()` es equivalente a:

```
ANY(SELECT(CampoDeseado, Condición))
```

**Ejemplo:**
```
ANY(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
```

### ✅ Sintaxis de SELECT

```
SELECT(CampoDeseado, Condición)
```

**Ejemplo:**
```
SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon])
```

**Nota:** `SELECT()` devuelve una lista. Usa `ANY()` o `FIRST()` para obtener un solo valor:
```
ANY(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
FIRST(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
```

### 📖 Referencia Oficial

- [AppSheet LOOKUP() Documentation](https://support.google.com/appsheet/answer/10107410)
- La documentación explica que `LOOKUP()` es un wrapper de `SELECT()` con `ANY()`
- Es importante usar `[_THISROW]` cuando hay ambigüedad en el contexto

---

## 🎯 Mejores Prácticas

1. **✅ Usar LOOKUP() con sintaxis oficial**: Usa la sintaxis correcta: `LOOKUP(_value_, "_dataset_", "_column_", "_return-column_")`
2. **✅ Usar comillas en nombres de tabla y columnas**: Los parámetros `_dataset_`, `_column_`, y `_return-column_` DEBEN estar entre comillas
3. **✅ Usar [_THISROW] para evitar ambigüedades**: Cuando referencias columnas de la fila actual, usa `[_THISROW].[telefon]` en lugar de solo `[telefon]`
4. **✅ Validar datos**: Siempre verifica que el teléfono exista antes de buscar el nombre usando `ISBLANK()`
5. **✅ Manejar errores**: Usa `IFERROR()` o `COALESCE()` para manejar casos donde no se encuentra el cliente
6. **✅ Permitir búsqueda**: Configura el selector para permitir búsqueda por nombre y teléfono
7. **✅ Actualización automática**: Configura el campo para que se actualice automáticamente cuando cambie el teléfono
8. **✅ Permisos**: Asegúrate de que los usuarios tengan permisos de lectura en CLIENT
9. **✅ Nombres exactos**: Verifica que los nombres de tablas y columnas coincidan exactamente (mayúsculas/minúsculas)
10. **✅ Consultar documentación oficial**: Referencia: [AppSheet LOOKUP() Documentation](https://support.google.com/appsheet/answer/10107410)

---

## 📝 Ejemplo Completo de Configuración

### Configuración del Campo telefon

```
Table: RESERVA
Column: telefon
Type: Text
Reference: Yes
Reference Table: CLIENT
Reference Key: CLIENT[telefon]
Display Column: CLIENT[nom_complet]
Show Search: Yes
Search Fields: CLIENT[nom_complet], CLIENT[telefon]
Allow Add New: Yes
Display Format: "[nom_complet] - [telefon]"
```

### Configuración del Campo nom_persona_reserva

```
Table: RESERVA
Column: nom_persona_reserva
Type: Text
Initial Value: IF(ISBLANK([telefon]), "", LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet"))
Read Only: Yes (opcional)
Refresh When: [telefon] changes
```

---

## 🚀 Siguientes Pasos

Una vez configurada la relación, puedes:

1. **Crear vistas personalizadas** que muestren información del cliente
2. **Agregar validaciones** para asegurar que el teléfono exista
3. **Configurar notificaciones** cuando se crea una nueva reserva
4. **Crear dashboards** que muestren estadísticas por cliente
5. **Agregar campos calculados** basados en la relación (ej: historial de reservas del cliente)

---

## 📞 Soporte

Si tienes problemas con la configuración:

1. Revisa los logs en **AppSheet Monitor**
2. Verifica la documentación oficial de AppSheet: [help.appsheet.com](https://help.appsheet.com)
3. Consulta la sección de solución de problemas arriba
4. Verifica que la sintaxis de las fórmulas sea correcta

---

## 🔧 Solución Rápida al Error de LOOKUP()

Si recibes el error: `"LOOKUP() requires the second argument to be a table name text literal"`

**❌ NO uses esto:**
```
LOOKUP(CLIENT[nom_complet], CLIENT[telefon] = [telefon])  // ERROR
LOOKUP([telefon], CLIENT, telefon, nom_complet)  // ERROR - falta comillas
```

**✅ USA esto (Sintaxis oficial correcta):**
```
IF(
  ISBLANK([telefon]),
  "",
  LOOKUP([_THISROW].[telefon], "CLIENT", "telefon", "nom_complet")
)
```

**O esta alternativa usando SELECT:**
```
IF(
  ISBLANK([telefon]),
  "",
  ANY(SELECT(CLIENT[nom_complet], CLIENT[telefon] = [_THISROW].[telefon]))
)
```

**📖 Referencia oficial:** [AppSheet LOOKUP() Documentation](https://support.google.com/appsheet/answer/10107410)

**Puntos clave:**
- El segundo parámetro debe ser texto literal entre comillas: `"CLIENT"`
- Los nombres de columnas deben estar entre comillas: `"telefon"`, `"nom_complet"`
- Usa `[_THISROW].[telefon]` para referenciar explícitamente la columna de la fila actual

---

**Última actualización:** Diciembre 2024  
**Versión:** 2.0.0 - Corregido con sintaxis oficial de LOOKUP() según documentación de AppSheet  
**Referencia:** [AppSheet LOOKUP() Documentation](https://support.google.com/appsheet/answer/10107410)  
**Mantenido por:** CronosAI

