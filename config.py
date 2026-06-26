import os
from dotenv import load_dotenv

load_dotenv()

# SQL-аутентификация для Docker и локального запуска
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mssql+pyodbc://bom_reader:kfgecbr@11-VM-DWH01/CSB_FK_REP"
    "?driver=ODBC+Driver+17+for+SQL+Server"
    "&TrustServerCertificate=yes"
)