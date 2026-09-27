const express = require('express')

const app = express()
app.use(express.json())

const todos = []

app.get('/todos', (req, res) => {
  res.json(todos)
})

app.post('/todos', (req, res) => {
  const todo = { id: todos.length + 1, title: req.body.title, done: false }
  todos.push(todo)
  res.status(201).json(todo)
})

app.patch('/todos/:id', (req, res) => {
  const todo = todos.find((t) => t.id === Number(req.params.id))
  if (!todo) return res.status(404).end()
  Object.assign(todo, req.body)
  res.json(todo)
})

app.listen(3000, () => console.log('listening on :3000'))
