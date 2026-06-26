import os

# Замените BOM_DB на реальное имя вашей базы данных
DATABASE_URL = (
    "mssql+pyodbc://11-VM-DWH01/CSB_FK_REP"
    "?driver=ODBC+Driver+17+for+SQL+Server"
    "&trusted_connection=yes"
    "&TrustServerCertificate=yes"
)