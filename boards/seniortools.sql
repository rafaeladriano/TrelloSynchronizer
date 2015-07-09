SELECT 
  column1 AS id,
  column2 AS title,
  column3 AS priority,
  column4 AS location,
  column5 AS responsible,
  CONVERT(VARCHAR(10), column6, 101) AS due,
  column7 AS hasClient

FROM Tasks