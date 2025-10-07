# src/database_handler.py
import os
import mysql.connector
from mysql.connector import Error
from datetime import datetime
import json

class DatabaseHandler:
    def __init__(self):
        """Inicializa la conexión a tu base de datos MySQL existente"""
        self.config = {
            'host': os.getenv('DB_HOST', 'db1.bwai.cc'),
            'port': int(os.getenv('DB_PORT', 3306)),
            'database': os.getenv('DB_NAME', 'cronosai'),
            'user': os.getenv('DB_USER', 'cronosdev'),
            'password': os.getenv('DB_PASS', ')CDJ6gwpCO9rg-W/'),
            'charset': 'utf8mb4',
            'autocommit': True
        }
        self.connection = None
    
    def connect(self):
        """Establece conexión con la base de datos"""
        try:
            self.connection = mysql.connector.connect(**self.config)
            if self.connection.is_connected():
                print("✅ Conectado a MySQL - CronosAI Database")
                return True
        except Error as e:
            print(f"❌ Error conectando a MySQL: {e}")
            return False
    
    def disconnect(self):
        """Cierra la conexión"""
        if self.connection and self.connection.is_connected():
            self.connection.close()
            print("🔌 Conexión a MySQL cerrada")
    
    def insert_client(self, nom_complet, telefon):
        """
        Inserta o actualiza cliente en tabla CLIENT
        
        Args:
            nom_complet (str): Nombre completo del cliente
            telefon (str): Teléfono del cliente
            
        Returns:
            bool: True si exitoso, False si error
        """
        try:
            cursor = self.connection.cursor()
            
            # Insertar o actualizar cliente
            query = """
            INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
            VALUES (%s, %s, NOW()) 
            ON DUPLICATE KEY UPDATE 
                NOM_COMPLET = VALUES(NOM_COMPLET), 
                DATA_ULTIMA_RESERVA = NOW()
            """
            
            cursor.execute(query, (nom_complet, telefon))
            print(f"✅ Cliente insertado/actualizado: {nom_complet}")
            return True
            
        except Error as e:
            print(f"❌ Error insertando cliente: {e}")
            return False
        finally:
            if cursor:
                cursor.close()
    
    def insert_reserva(self, data_reserva, num_persones, telefon, nom_persona_reserva, observacions=None, conversa_completa=None):
        """
        Inserta nueva reserva en tabla RESERVA
        
        Args:
            data_reserva (str): Fecha y hora de la reserva
            num_persones (int): Número de personas
            telefon (str): Teléfono del cliente
            nom_persona_reserva (str): Nombre de la persona que hace la reserva
            observacions (str): Observaciones opcionales
            conversa_completa (str): Conversación completa
            
        Returns:
            int: ID de la reserva insertada, None si error
        """
        try:
            cursor = self.connection.cursor()
            
            # Query corregida con los nombres reales de las columnas
            query = """
            INSERT INTO RESERVA 
            (data_reserva, num_persones, telefon, nom_persona_reserva, observacions, conversa_completa) 
            VALUES (%s, %s, %s, %s, %s, %s)
            """
            
            cursor.execute(query, (
                data_reserva, 
                num_persones, 
                telefon, 
                nom_persona_reserva, 
                observacions, 
                conversa_completa
            ))
            
            reserva_id = cursor.lastrowid
            print(f"✅ Reserva insertada con ID: {reserva_id}")
            return reserva_id
            
        except Error as e:
            print(f"❌ Error insertando reserva: {e}")
            return None
        finally:
            if cursor:
                cursor.close()
    
    def get_reserva_by_id(self, reserva_id):
        """
        Obtiene una reserva por ID
        
        Args:
            reserva_id (int): ID de la reserva
            
        Returns:
            dict: Datos de la reserva o None si no existe
        """
        try:
            cursor = self.connection.cursor(dictionary=True)
            
            query = "SELECT * FROM RESERVA WHERE id_reserva = %s"
            cursor.execute(query, (reserva_id,))
            
            result = cursor.fetchone()
            return result
            
        except Error as e:
            print(f"❌ Error obteniendo reserva: {e}")
            return None
        finally:
            if cursor:
                cursor.close()
    
    def get_reservas_by_telefon(self, telefon):
        """
        Obtiene reservas por teléfono
        
        Args:
            telefon (str): Teléfono del cliente
            
        Returns:
            list: Lista de reservas
        """
        try:
            cursor = self.connection.cursor(dictionary=True)
            
            query = """
            SELECT * FROM RESERVA 
            WHERE telefon = %s 
            ORDER BY data_reserva DESC
            """
            cursor.execute(query, (telefon,))
            
            results = cursor.fetchall()
            return results
            
        except Error as e:
            print(f"❌ Error obteniendo reservas: {e}")
            return []
        finally:
            if cursor:
                cursor.close()
    
    def update_reserva(self, reserva_id, **kwargs):
        """
        Actualiza una reserva existente
        
        Args:
            reserva_id (int): ID de la reserva
            **kwargs: Campos a actualizar
            
        Returns:
            bool: True si exitoso, False si error
        """
        try:
            cursor = self.connection.cursor()
            
            # Construir query dinámicamente
            set_clauses = []
            values = []
            
            for field, value in kwargs.items():
                set_clauses.append(f"{field} = %s")
                values.append(value)
            
            if not set_clauses:
                return False
            
            query = f"UPDATE RESERVA SET {', '.join(set_clauses)} WHERE id_reserva = %s"
            values.append(reserva_id)
            
            cursor.execute(query, values)
            
            if cursor.rowcount > 0:
                print(f"✅ Reserva {reserva_id} actualizada")
                return True
            else:
                print(f"⚠️ No se encontró reserva con ID {reserva_id}")
                return False
                
        except Error as e:
            print(f"❌ Error actualizando reserva: {e}")
            return False
        finally:
            if cursor:
                cursor.close()
    
    def delete_reserva(self, reserva_id):
        """
        Elimina una reserva
        
        Args:
            reserva_id (int): ID de la reserva
            
        Returns:
            bool: True si exitoso, False si error
        """
        try:
            cursor = self.connection.cursor()
            
            query = "DELETE FROM RESERVA WHERE id_reserva = %s"
            cursor.execute(query, (reserva_id,))
            
            if cursor.rowcount > 0:
                print(f"✅ Reserva {reserva_id} eliminada")
                return True
            else:
                print(f"⚠️ No se encontró reserva con ID {reserva_id}")
                return False
                
        except Error as e:
            print(f"❌ Error eliminando reserva: {e}")
            return False
        finally:
            if cursor:
                cursor.close()
    
    def test_connection(self):
        """Prueba la conexión a la base de datos"""
        try:
            if self.connect():
                cursor = self.connection.cursor()
                cursor.execute("SELECT VERSION()")
                version = cursor.fetchone()
                print(f"✅ MySQL versión: {version[0]}")
                
                # Probar acceso a las tablas
                cursor.execute("SHOW TABLES")
                tables = cursor.fetchall()
                print(f"✅ Tablas disponibles: {[table[0] for table in tables]}")
                
                cursor.close()
                return True
            return False
        except Error as e:
            print(f"❌ Error probando conexión: {e}")
            return False

# Función de prueba
def test_database():
    """Prueba la conexión y operaciones básicas"""
    db = DatabaseHandler()
    
    if db.test_connection():
        print("✅ Base de datos funcionando correctamente")
        
        # Probar inserción de cliente
        if db.insert_client("Test Cliente", "+49123456789"):
            print("✅ Inserción de cliente exitosa")
        
        # Probar inserción de reserva
        reserva_id = db.insert_reserva(
            data_reserva="2024-03-20 20:00:00",
            num_persones=4,
            telefon="+49123456789",
            nom_persona_reserva="Test Cliente",
            observacions="Reserva de prueba",
            conversa_completa="Conversación de prueba para testing"
        )
        
        if reserva_id:
            print(f"✅ Inserción de reserva exitosa - ID: {reserva_id}")
            
            # Probar consulta
            reserva = db.get_reserva_by_id(reserva_id)
            if reserva:
                print(f"✅ Consulta de reserva exitosa: {reserva}")
        
        db.disconnect()
    else:
        print("❌ Error en la conexión a la base de datos")

if __name__ == "__main__":
    test_database()